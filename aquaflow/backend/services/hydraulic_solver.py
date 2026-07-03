"""
hydraulic_solver.py — AquaFlow Stage 2, Priority 1 (AQ-S2-001)

Steady-state hydraulic network solver for fountain pipe networks.

Solves for the flow in every pipe and the head/pressure at every node of an
arbitrary pipe network — branched (tree), looped, or closed-loop recirculating —
using the Global Gradient Algorithm (Todini & Pilati, 1988), the same method
EPANET is built on. Both mass conservation (at every node) and energy
conservation (around every loop) are satisfied simultaneously by a
Newton-Raphson solve of the coupled nonlinear system, so branched and looped
topologies are handled by one uniform algorithm.

Governing relations
--------------------
* Head loss along a pipe (Hazen-Williams, SI):
      h = r * Q * |Q|^(n-1),   n = 1.852,
      r = 10.67 * L / (C^1.852 * d^4.87)
  (Darcy-Weisbach with a fixed friction factor is also supported, n = 2.)
* Optional minor loss: h_minor = k * Q * |Q| / (2 g A^2).
* Continuity at every junction: net pipe outflow = -demand.
* Energy around every loop: sum of signed head losses = 0.

Units are SI throughout: flow m^3/s, length/diameter m, head m. Pressure is
reported as head above node elevation and converted to kPa / bar.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

# Physical constants (fresh water @ ~15 C).
GRAVITY = 9.81          # m/s^2
WATER_DENSITY = 1000.0  # kg/m^3

HW_EXPONENT = 1.852     # Hazen-Williams flow exponent
_Q_FLOOR = 1e-6         # m^3/s — floors |Q| in the derivative to keep it non-singular


@dataclass
class HydraulicNode:
    id: str
    elevation: float = 0.0          # m
    demand: float = 0.0             # m^3/s, positive = water drawn from the node
    fixed_head: Optional[float] = None  # m — set for reservoirs / pump-discharge / tanks


@dataclass
class HydraulicPipe:
    id: str
    from_node: str
    to_node: str
    length: float = 1.0             # m
    diameter: float = 0.1           # m
    roughness: float = 130.0        # Hazen-Williams C (or Darcy friction factor f)
    minor_loss: float = 0.0         # dimensionless K (fittings/valves)


@dataclass
class HydraulicResult:
    converged: bool
    iterations: int
    method: str
    node_head: dict          # id -> head (m)
    node_pressure_m: dict    # id -> pressure head above elevation (m)
    pipe_flow: dict          # id -> flow (m^3/s), + = from_node -> to_node
    pipe_headloss: dict      # id -> head loss (m)
    pipe_velocity: dict      # id -> velocity (m/s)
    max_continuity_residual: float
    max_loop_residual: float
    topology: dict = field(default_factory=dict)


class HydraulicNetworkSolver:
    def __init__(self, method: str = "hazen-williams", max_iter: int = 200,
                 tol: float = 1e-8):
        self.method = str(method or "hazen-williams").lower()
        self.max_iter = max_iter
        self.tol = tol

    # ── Pipe resistance model ─────────────────────────────────────────────────
    def _pipe_resistance(self, pipe: HydraulicPipe) -> tuple[float, float]:
        """Return (r, n) so that head loss = r * Q * |Q|^(n-1)."""
        d = max(pipe.diameter, 1e-6)
        L = max(pipe.length, 0.0)
        if self.method.startswith("darcy"):
            f = max(pipe.roughness, 1e-6)   # roughness reused as Darcy friction factor
            area = math.pi * d * d / 4.0
            r = 8.0 * f * L / (math.pi ** 2 * GRAVITY * d ** 5)
            return r, 2.0
        # Hazen-Williams (default)
        C = max(pipe.roughness, 1e-6)
        r = 10.67 * L / (C ** HW_EXPONENT * d ** 4.87)
        return r, HW_EXPONENT

    def _minor_coeff(self, pipe: HydraulicPipe) -> float:
        """Minor-loss coefficient m so h_minor = m * Q * |Q| (quadratic)."""
        if pipe.minor_loss <= 0:
            return 0.0
        d = max(pipe.diameter, 1e-6)
        area = math.pi * d * d / 4.0
        return pipe.minor_loss / (2.0 * GRAVITY * area * area)

    # ── Solver ────────────────────────────────────────────────────────────────
    def solve(self, nodes: list[HydraulicNode], pipes: list[HydraulicPipe]) -> HydraulicResult:
        if not pipes:
            raise ValueError("Network has no pipes")
        node_by_id = {n.id: n for n in nodes}
        for p in pipes:
            if p.from_node not in node_by_id or p.to_node not in node_by_id:
                raise ValueError(f"Pipe '{p.id}' references an unknown node")

        fixed = [n for n in nodes if n.fixed_head is not None]
        if not fixed:
            raise ValueError("Network needs at least one fixed-head node (reservoir/source)")

        unknown = [n for n in nodes if n.fixed_head is None]
        u_index = {n.id: i for i, n in enumerate(unknown)}
        f_index = {n.id: i for i, n in enumerate(fixed)}
        nn = len(unknown)
        nl = len(pipes)

        # Incidence matrices. A12[p, i] = +1 if node i is the pipe's from-node,
        # -1 if its to-node, so (A12 @ H)_p = H_from - H_to = head loss.
        A12 = np.zeros((nl, nn))
        A10 = np.zeros((nl, len(fixed)))
        for p_i, p in enumerate(pipes):
            for node_id, sign in ((p.from_node, 1.0), (p.to_node, -1.0)):
                if node_id in u_index:
                    A12[p_i, u_index[node_id]] += sign
                else:
                    A10[p_i, f_index[node_id]] += sign
        A21 = A12.T

        r_vec = np.zeros(nl)
        n_vec = np.zeros(nl)
        m_vec = np.zeros(nl)
        for p_i, p in enumerate(pipes):
            r_vec[p_i], n_vec[p_i] = self._pipe_resistance(p)
            m_vec[p_i] = self._minor_coeff(p)

        H0 = np.array([n.fixed_head for n in fixed], dtype=float)
        demand = np.array([n.demand for n in unknown], dtype=float)

        # Initial guess: small positive flows; junction heads at mean fixed head.
        Q = np.full(nl, 1e-3)
        H = np.full(nn, float(np.mean(H0)))

        converged = False
        it = 0
        for it in range(1, self.max_iter + 1):
            absQ = np.maximum(np.abs(Q), _Q_FLOOR)
            # Head loss magnitude coefficient a = r|Q|^(n-1) + m|Q|; head loss = a*Q.
            a = r_vec * absQ ** (n_vec - 1.0) + m_vec * absQ
            # Derivative dh/dQ = n r|Q|^(n-1) + 2 m|Q|.
            g = n_vec * r_vec * absQ ** (n_vec - 1.0) + 2.0 * m_vec * absQ
            g = np.maximum(g, 1e-12)

            # Residuals of the current iterate.
            energy_res = a * Q - A12 @ H - A10 @ H0        # nl
            cont_res = A21 @ Q + demand                    # nn

            Dinv = 1.0 / g
            # Schur-complement (weighted graph Laplacian) for the head update.
            F = A21 @ (Dinv[:, None] * A12)                # nn x nn, SPD
            rhs = A21 @ (Dinv * energy_res) - cont_res
            try:
                dH = np.linalg.solve(F, rhs)
            except np.linalg.LinAlgError:
                dH = np.linalg.lstsq(F, rhs, rcond=None)[0]
            dQ = Dinv * (A12 @ dH - energy_res)

            H = H + dH
            Q = Q + dQ

            if max(np.max(np.abs(dQ)) if nl else 0.0,
                   np.max(np.abs(dH)) if nn else 0.0) < self.tol:
                converged = True
                break

        # ── Assemble results ──────────────────────────────────────────────────
        head_all = {}
        for n in fixed:
            head_all[n.id] = float(n.fixed_head)
        for i, n in enumerate(unknown):
            head_all[n.id] = float(H[i])

        node_pressure_m = {n.id: head_all[n.id] - n.elevation for n in nodes}

        pipe_flow, pipe_headloss, pipe_velocity = {}, {}, {}
        absQ = np.maximum(np.abs(Q), _Q_FLOOR)
        a_final = r_vec * absQ ** (n_vec - 1.0) + m_vec * absQ
        for p_i, p in enumerate(pipes):
            q = float(Q[p_i])
            pipe_flow[p.id] = q
            pipe_headloss[p.id] = float(a_final[p_i] * q)
            area = math.pi * max(p.diameter, 1e-6) ** 2 / 4.0
            pipe_velocity[p.id] = q / area

        # Continuity residual at every node (including the balance that the fixed
        # nodes must supply): recompute from final flows.
        max_cont = 0.0
        for n in unknown:
            net_out = 0.0
            for p_i, p in enumerate(pipes):
                if p.from_node == n.id:
                    net_out += Q[p_i]
                elif p.to_node == n.id:
                    net_out -= Q[p_i]
            max_cont = max(max_cont, abs(net_out + n.demand))

        # Loop (energy) residual: for any closed loop the signed head-loss sum is
        # zero. We verify the stronger equivalent — every pipe's head loss equals
        # the head difference between its endpoints — whose max is the loop error.
        max_loop = 0.0
        for p_i, p in enumerate(pipes):
            expected = head_all[p.from_node] - head_all[p.to_node]
            max_loop = max(max_loop, abs(pipe_headloss[p.id] - expected))

        topo = self._topology(nodes, pipes)

        return HydraulicResult(
            converged=converged,
            iterations=it,
            method=self.method,
            node_head=head_all,
            node_pressure_m=node_pressure_m,
            pipe_flow=pipe_flow,
            pipe_headloss=pipe_headloss,
            pipe_velocity=pipe_velocity,
            max_continuity_residual=float(max_cont),
            max_loop_residual=float(max_loop),
            topology=topo,
        )

    # ── Topology classification ───────────────────────────────────────────────
    @staticmethod
    def _topology(nodes: list[HydraulicNode], pipes: list[HydraulicPipe]) -> dict:
        parent = {n.id: n.id for n in nodes}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

        for p in pipes:
            union(p.from_node, p.to_node)
        components = len({find(n.id) for n in nodes})
        # Independent loops (circuit rank) = E - N + C.
        loops = len(pipes) - len(nodes) + components
        loops = max(loops, 0)
        return {
            "nodes": len(nodes),
            "pipes": len(pipes),
            "components": components,
            "independent_loops": loops,
            "has_loops": loops > 0,
            "branched": loops == 0,
        }


# ── Convenience: solve from a plain dict payload ───────────────────────────────
def solve_network(payload: dict) -> dict:
    """Solve a network described by a JSON-friendly dict and return a dict result."""
    nodes = [
        HydraulicNode(
            id=str(n["id"]),
            elevation=float(n.get("elevation", 0.0)),
            demand=float(n.get("demand", 0.0)),
            fixed_head=(None if n.get("fixed_head") is None else float(n["fixed_head"])),
        )
        for n in payload.get("nodes", [])
    ]
    pipes = [
        HydraulicPipe(
            id=str(p["id"]),
            from_node=str(p.get("from", p.get("from_node"))),
            to_node=str(p.get("to", p.get("to_node"))),
            length=float(p.get("length", 1.0)),
            diameter=float(p.get("diameter", 0.1)),
            roughness=float(p.get("roughness", 130.0)),
            minor_loss=float(p.get("minor_loss", 0.0)),
        )
        for p in payload.get("pipes", [])
    ]
    solver = HydraulicNetworkSolver(
        method=payload.get("method", "hazen-williams"),
        max_iter=int(payload.get("max_iter", 200)),
        tol=float(payload.get("tol", 1e-8)),
    )
    res = solver.solve(nodes, pipes)

    node_by_id = {n.id: n for n in nodes}
    return {
        "converged": res.converged,
        "iterations": res.iterations,
        "method": res.method,
        "topology": res.topology,
        "residuals": {
            "max_continuity": res.max_continuity_residual,
            "max_loop_energy": res.max_loop_residual,
        },
        "nodes": [
            {
                "id": nid,
                "head_m": round(res.node_head[nid], 6),
                "pressure_m": round(res.node_pressure_m[nid], 6),
                "pressure_kpa": round(WATER_DENSITY * GRAVITY * res.node_pressure_m[nid] / 1000.0, 4),
                "pressure_bar": round(WATER_DENSITY * GRAVITY * res.node_pressure_m[nid] / 1e5, 5),
                "demand": node_by_id[nid].demand,
                "fixed": node_by_id[nid].fixed_head is not None,
            }
            for nid in res.node_head
        ],
        "pipes": [
            {
                "id": pid,
                "flow_m3s": round(res.pipe_flow[pid], 8),
                "flow_lpm": round(res.pipe_flow[pid] * 60000.0, 4),
                "velocity_ms": round(res.pipe_velocity[pid], 6),
                "headloss_m": round(res.pipe_headloss[pid], 6),
            }
            for pid in res.pipe_flow
        ],
    }
