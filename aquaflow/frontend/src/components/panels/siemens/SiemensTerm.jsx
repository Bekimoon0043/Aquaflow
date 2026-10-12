import { useEffect, useRef, useState } from "react";
import { GLOSSARY } from "../../../utils/siemensDevices";

// A Siemens word with a plain-language explanation on hover / click / keyboard focus.
export default function SiemensTerm({ k, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const entry = GLOSSARY[k];
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (!entry) return children;
  return <span ref={ref} style={{ position: "relative", display: "inline-block" }}
    onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" className="s7-term" aria-expanded={open} aria-label={`${entry[0]}: what is this?`}
      onClick={() => setOpen(v => !v)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children || entry[0]}
    </button>
    {open && <span role="tooltip" className="s7-term__pop"><b>{entry[0]}</b>{entry[1]}</span>}
  </span>;
}
