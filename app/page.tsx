"use client";

/**
 * page.tsx — ChatTube-style single page.
 *
 * Layout: a sidebar (library + Add Video) and a main pane that shows either the
 * library grid or the chat view for the selected video. The background image and
 * the topic timeline both come from the LLM analysis returned by /api/ingest.
 *
 * All state lives in the browser (videos, their chunks, their chat history), so
 * the backend stays stateless and deploys to Vercel with no database.
 */

import { useState } from "react";
import TopicBackground from "./components/TopicBackground";
import Timeline, { type Chapter } from "./components/Timeline";

interface Chunk {
  id: number;
  text: string;
  embedding: number[];
}
interface Source {
  id: number;
  score: number;
  preview: string;
}
interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}
interface Video {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  durationSeconds: number;
  topics: string[];
  imageQuery: string;
  chapters: Chapter[];
  chunks: Chunk[];
  messages: Message[];
}

const SUGGESTIONS = [
  "Summarize this video in 3 points.",
  "What are the key takeaways?",
  "What tools or products are mentioned?",
  "Who is this video for?",
];

/**
 * Read a fetch Response as JSON, but survive non-JSON bodies. Vercel returns a
 * plain-text "An error occurred…" page when a serverless function times out or
 * crashes — this turns that into a friendly message instead of a parse error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readResponse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 504 || /timeout|timed out/i.test(text)) {
      return { error: "This video took too long to process (server timed out). Try a shorter video." };
    }
    return { error: "The server hit an unexpected error. Please try again in a moment." };
  }
}

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);

  const selected = videos.find((v) => v.id === selectedId) || null;

  async function addVideo() {
    if (!url.trim() || ingesting) return;
    setIngesting(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await readResponse(res);
      if (!res.ok) throw new Error(data.error || "Failed to add video.");

      const video: Video = {
        id: data.videoId,
        title: data.meta.title,
        author: data.meta.author,
        thumbnail: data.meta.thumbnail,
        durationSeconds: data.durationSeconds,
        topics: data.topics,
        imageQuery: data.imageQuery,
        chapters: data.chapters,
        chunks: data.chunks,
        messages: [],
      };
      setVideos((prev) => [video, ...prev.filter((v) => v.id !== video.id)]);
      setSelectedId(video.id);
      setUrl("");
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add video.");
    } finally {
      setIngesting(false);
    }
  }

  async function ask(q: string) {
    const text = q.trim();
    if (!text || thinking || !selected) return;

    const history = selected.messages.map((m) => ({ role: m.role, content: m.content }));
    updateVideo(selected.id, (v) => ({ ...v, messages: [...v.messages, { role: "user", content: text }] }));
    setQuestion("");
    setThinking(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, chunks: selected.chunks, history }),
      });
      const data = await readResponse(res);
      if (!res.ok) throw new Error(data.error || "Failed to answer.");
      updateVideo(selected.id, (v) => ({
        ...v,
        messages: [...v.messages, { role: "assistant", content: data.answer, sources: data.sources }],
      }));
    } catch (err) {
      updateVideo(selected.id, (v) => ({
        ...v,
        messages: [
          ...v.messages,
          { role: "assistant", content: "⚠️ " + (err instanceof Error ? err.message : "Failed to answer.") },
        ],
      }));
    } finally {
      setThinking(false);
    }
  }

  function updateVideo(id: string, fn: (v: Video) => Video) {
    setVideos((prev) => prev.map((v) => (v.id === id ? fn(v) : v)));
  }

  return (
    <div className="app">
      {selected && <TopicBackground query={selected.imageQuery} seed={selected.id} />}

      {/* ---------------- Sidebar ---------------- */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">▶</div>
          <div>
            <div className="brand-name">ChatTube.ai</div>
            <div className="brand-sub">Chat with any video</div>
          </div>
        </div>

        <button className="add-btn" onClick={() => setModalOpen(true)}>
          + Add Video
        </button>

        <button className="nav-item" onClick={() => setSelectedId(null)}>
          <span className="nav-ico">💬</span> All Videos
        </button>

        <div className="side-list">
          {videos.map((v) => (
            <button
              key={v.id}
              className={`side-video ${v.id === selectedId ? "on" : ""}`}
              onClick={() => setSelectedId(v.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.thumbnail} alt="" className="side-thumb" />
              <div className="side-meta">
                <div className="side-title">{v.title}</div>
                <div className="side-ready">✓ Ready</div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ---------------- Main ---------------- */}
      <main className="main">
        {!selected ? (
          <LibraryView videos={videos} onSelect={setSelectedId} onAdd={() => setModalOpen(true)} />
        ) : (
          <div className="chat-view">
            <header className="chat-header">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selected.thumbnail} alt="" className="chat-head-thumb" />
              <div>
                <div className="chat-head-title">{selected.title}</div>
                <div className="chat-head-ready">✓ Ready</div>
              </div>
              <div className="topic-tags">
                {selected.topics.map((t) => (
                  <span key={t} className="topic-tag">{t}</span>
                ))}
              </div>
            </header>

            <div className="chat-body">
              <Timeline
                chapters={selected.chapters}
                durationSeconds={selected.durationSeconds}
                videoId={selected.id}
              />

              {selected.messages.length === 0 && (
                <div className="empty-hint">
                  <p className="muted">Ask anything about this video. Try:</p>
                  <div className="suggestions">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => ask(s)}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {selected.messages.map((m, i) => (
                <div key={i} className={`msg-row ${m.role}`}>
                  {m.role === "assistant" && <div className="avatar bot">🤖</div>}
                  <div className={`bubble ${m.role}`}>
                    {m.content}
                    {m.sources && m.sources.length > 0 && (
                      <div className="sources">
                        {m.sources.map((s) => (
                          <span key={s.id} className="pill" title={s.preview}>
                            #{s.id} · {s.score}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {m.role === "user" && <div className="avatar user">🧑</div>}
                </div>
              ))}
              {thinking && (
                <div className="msg-row assistant">
                  <div className="avatar bot">🤖</div>
                  <div className="bubble assistant">Thinking…</div>
                </div>
              )}
            </div>

            <div className="composer">
              <input
                type="text"
                placeholder="Ask a question about the video…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask(question)}
              />
              <button onClick={() => ask(question)} disabled={thinking || !question.trim()}>
                Send
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ---------------- Add Video modal ---------------- */}
      {modalOpen && (
        <div className="modal-backdrop" onClick={() => !ingesting && setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => !ingesting && setModalOpen(false)}>×</button>
            <div className="modal-head">
              <div className="brand-logo sm">▶</div>
              <h2>Add YouTube Video</h2>
            </div>
            <p className="muted">
              Paste any YouTube video URL. The app extracts the transcript, builds a
              knowledge base, and generates topic imagery + a timeline.
            </p>
            <input
              type="text"
              autoFocus
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addVideo()}
            />
            {error && <div className="error">{error}</div>}
            <div className="modal-actions">
              <button className="ghost" onClick={() => !ingesting && setModalOpen(false)}>Cancel</button>
              <button className="add-btn sm" onClick={addVideo} disabled={ingesting || !url.trim()}>
                {ingesting ? "Processing…" : "Add Video"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LibraryView({
  videos,
  onSelect,
  onAdd,
}: {
  videos: Video[];
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="library">
      <header className="library-head">
        <div>
          <h1>Your Library</h1>
          <p className="muted">
            {videos.length} video{videos.length === 1 ? "" : "s"} in your knowledge base
          </p>
        </div>
        <button className="add-btn" onClick={onAdd}>+ Add Video</button>
      </header>

      <div className="grid">
        {videos.map((v) => (
          <button key={v.id} className="card-video" onClick={() => onSelect(v.id)}>
            <div className="card-thumb-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.thumbnail} alt="" className="card-thumb" />
              <span className="ready-badge">✓ Ready</span>
            </div>
            <div className="card-title">{v.title}</div>
          </button>
        ))}
        <button className="card-add" onClick={onAdd}>
          <div className="card-add-plus">+</div>
          Add Video
        </button>
      </div>
    </div>
  );
}
