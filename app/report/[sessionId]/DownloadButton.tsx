"use client";

/** Triggers the browser's print-to-PDF on the report. Print CSS (globals.css)
 *  hides the action bar so the saved PDF is just the report. */
export function DownloadButton({ style }: { style?: React.CSSProperties }) {
  return (
    <button type="button" onClick={() => window.print()} style={style}>
      Download PDF
    </button>
  );
}
