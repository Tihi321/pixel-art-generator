export function App() {
  return (
    <div className="shell">
      <aside className="region toolbar" data-testid="toolbar">
        <span className="label">Tools</span>
      </aside>
      <main className="region canvas" data-testid="canvas">
        <span className="label">Canvas</span>
      </main>
      <aside className="region panels" data-testid="panels">
        <span className="label">Panels</span>
      </aside>
      <footer className="region timeline" data-testid="timeline">
        <span className="label">Timeline</span>
      </footer>
    </div>
  )
}
