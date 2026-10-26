// @vitest-environment jsdom
// Memory banner: shown when the desktop shell reports no page file / low commit; "Don't show
// again" is remembered; nothing shows when the PC is fine or outside the desktop app.
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import MemoryBanner, { MEMORY_BANNER_DISMISS_KEY, memoryBannerText } from "../MemoryBanner";

globalThis.React = React;

const NO_PAGE_FILE = { ok: true, warn: true, reasons: ["no-page-file", "low-free-commit"], hasPageFile: false, freeCommitMB: 753, commitLimitMB: 16162 };

describe("MemoryBanner", () => {
  afterEach(() => { cleanup(); window.localStorage.clear(); delete window.aquaflow; });

  it("explains the missing page file and shows the steps on request", async () => {
    render(<MemoryBanner getStatus={() => Promise.resolve(NO_PAGE_FILE)} />);
    await act(async () => {});
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toMatch(/no page file/);
    expect(banner.textContent).toMatch(/0\.7 GB/);
    fireEvent.click(screen.getByRole("button", { name: "How to fix" }));
    expect(banner.textContent).toMatch(/sysdm\.cpl/);
    expect(banner.textContent).toMatch(/Automatically manage paging file size for all drives/);
  });

  it("Don't show again hides it now and on the next start", async () => {
    render(<MemoryBanner getStatus={() => Promise.resolve(NO_PAGE_FILE)} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Don't show again" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.localStorage.getItem(MEMORY_BANNER_DISMISS_KEY)).toBe("1");
    cleanup();
    let asked = false;
    render(<MemoryBanner getStatus={() => { asked = true; return Promise.resolve(NO_PAGE_FILE); }} />);
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(asked).toBe(false);
  });

  it("Close hides it for this session only", async () => {
    render(<MemoryBanner getStatus={() => Promise.resolve(NO_PAGE_FILE)} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.localStorage.getItem(MEMORY_BANNER_DISMISS_KEY)).toBeNull();
  });

  it("stays hidden when memory is fine, the check failed, or there is no desktop shell", async () => {
    render(<MemoryBanner getStatus={() => Promise.resolve({ ok: true, warn: false, reasons: [] })} />);
    render(<MemoryBanner getStatus={() => Promise.reject(new Error("no shell"))} />);
    render(<MemoryBanner />);
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses the desktop bridge by default", async () => {
    window.aquaflow = { system: { memoryStatus: () => Promise.resolve(NO_PAGE_FILE) } };
    render(<MemoryBanner />);
    await act(async () => {});
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("low commit with a page file gives the low-memory wording", () => {
    expect(memoryBannerText({ reasons: ["low-free-commit"], freeCommitMB: 1536 })).toMatch(/low on memory \(1\.5 GB left/);
  });
});
