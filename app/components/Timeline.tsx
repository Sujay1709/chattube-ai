"use client";

/**
 * Timeline — the sliding tool.
 *
 * The LLM returns "chapters": { start, title, summary }. This component renders a
 * scrubber across the video's duration. As you drag, it shows which topic is
 * active at that moment and offers a deep-link that opens YouTube at that time.
 */

import { useState } from "react";
import { formatTime } from "@/lib/youtube";

export interface Chapter {
  start: number;
  title: string;
  summary: string;
}

export default function Timeline({
  chapters,
  durationSeconds,
  videoId,
}: {
  chapters: Chapter[];
  durationSeconds: number;
  videoId: string;
}) {
  const [t, setT] = useState(0);
  const [open, setOpen] = useState(true);
  if (!chapters.length || durationSeconds <= 0) return null;

  // Active chapter = the last one whose start is <= current time.
  let activeIdx = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= t) activeIdx = i;
  }
  const active = chapters[activeIdx];
  const ytLink = `https://www.youtube.com/watch?v=${videoId}&t=${Math.round(t)}s`;

  return (
    <div className={`timeline ${open ? "" : "collapsed"}`}>
      <button
        className="timeline-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="timeline-label">🎞️ Topic timeline</span>
        <span className="timeline-time">
          {formatTime(t)} <span className="muted">/ {formatTime(durationSeconds)}</span>
          <span className="timeline-caret">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      <div className="timeline-body">
      <div className="timeline-track-wrap">
        {/* Chapter markers */}
        <div className="timeline-marks">
          {chapters.map((c, i) => (
            <button
              key={i}
              className={`timeline-mark ${i === activeIdx ? "on" : ""}`}
              style={{ left: `${(c.start / durationSeconds) * 100}%` }}
              title={`${formatTime(c.start)} — ${c.title}`}
              onClick={() => setT(c.start)}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={durationSeconds}
          step={1}
          value={t}
          onChange={(e) => setT(Number(e.target.value))}
          className="timeline-range"
        />
      </div>

      <div className="timeline-active">
        <div className="timeline-active-title">
          <span className="chapter-badge">{formatTime(active.start)}</span>
          {active.title}
        </div>
        {active.summary && <div className="timeline-active-summary">{active.summary}</div>}
        <a href={ytLink} target="_blank" rel="noreferrer" className="timeline-link">
          ▶ Open in YouTube at {formatTime(t)}
        </a>
      </div>

      <div className="chapter-chips">
        {chapters.map((c, i) => (
          <button
            key={i}
            className={`chapter-chip ${i === activeIdx ? "on" : ""}`}
            onClick={() => setT(c.start)}
          >
            <span className="chapter-chip-time">{formatTime(c.start)}</span>
            {c.title}
          </button>
        ))}
      </div>
      </div>
    </div>
  );
}
