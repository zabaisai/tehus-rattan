"use client";

// Root error boundary (replaces the whole document, so it must render its own
// <html>/<body>). Neutral message only — no raw error surfaced to the user.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="es">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#fafaf9",
          color: "#1c1917",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>Algo salió mal</h1>
        <p style={{ marginTop: 4, fontSize: 14, color: "#78716c" }}>
          Ocurrió un error inesperado.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 24,
            borderRadius: 6,
            background: "#1c1917",
            color: "#fff",
            padding: "8px 16px",
            fontSize: 14,
            border: "none",
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
