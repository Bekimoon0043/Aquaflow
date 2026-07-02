import React from "react";

export default function Timeline({ height = 260 }) {
  const tracks = [
    { name: "Audio", cues: ["Waveform", "Beat markers"] },
    { name: "Pumps", cues: ["Pump 01 ramp", "Pump 02 burst"] },
    { name: "Valves", cues: ["Solenoid chase", "Jet pulse"] },
    { name: "Lighting", cues: ["RGB wash", "Strobe accent"] }
  ];

  return (
    <section className="timeline" style={{ height }}>
      <div className="timeline-header">
        <strong>Show Timeline</strong>
        <span>00:00:00 / Dry Run</span>
      </div>
      <div className="timeline-tracks">
        {tracks.map((track) => (
          <div className="timeline-row" key={track.name}>
            <div className="track-name">{track.name}</div>
            <div className="track-lane">
              {track.cues.map((cue, i) => (
                <div className="cue" style={{ left: `${8 + i * 32}%`, width: `${22 + i * 8}%` }} key={cue}>
                  {cue}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
