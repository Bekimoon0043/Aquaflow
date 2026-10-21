// Show Studio toolbar entry for Site sync: opens the dialog (settings in studio.site.sync,
// undoable through the show document) and, with "Preview as heard at the audience" on, keeps the
// Studio preview's song behind the picture by the audio chain to the listener.
import React, { useEffect, useRef, useState } from 'react';
import SiteSyncDialog from './SiteSyncDialog';
import { patchSync } from './siteSync';
import { syncAudioElement } from './previewAudio';

export default function SiteSyncButton({ items = [], studio, change, clips = null, audio = null, time = 0, playing = false }) {
  const [open, setOpen] = useState(false);
  const sync = studio?.site?.sync || {};
  const delayS = sync.previewAsHeard && Number(sync.previewDelayMs) > 0 ? Number(sync.previewDelayMs) / 1000 : 0;
  const was = useRef(0);
  useEffect(() => {
    const el = audio?.current;
    if (!el) return;
    if (delayS) syncAudioElement(el, { position: time - delayS, playback: playing ? 'playing' : 'stopped' }, { tolerance: .04 });
    else if (was.current) { el.currentTime = time; if (playing && el.paused) el.play?.()?.catch?.(() => {}); }
    was.current = delayS;
  }, [audio, time, playing, delayS]);
  const onPatch = (patch) => change?.((s) => ({ ...s, site: patchSync(s.site, patch) }));
  return <>
    <button onClick={() => setOpen((v) => !v)} aria-pressed={open} title="Sound ↔ fountain timing on the real site">⏱ Site sync{delayS ? ' · as heard' : ''}</button>
    {open && <SiteSyncDialog items={items} site={studio?.site || {}} clips={clips} onPatch={onPatch} onClose={() => setOpen(false)} />}
  </>;
}
