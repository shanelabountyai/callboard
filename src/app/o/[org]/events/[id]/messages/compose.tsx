'use client';
import { useState } from 'react';

const LIMIT = 320; // one text; over it the message goes out as one line plus a link

/** The message body with its live count against one text's length (design brief: message composer). */
export function Compose() {
  const [n, setN] = useState(0);
  return (
    <>
      <label>Message <textarea name="body" rows={4} maxLength={2000} required placeholder="Doors now 9:15, not 9:00." aria-describedby="body-count" onChange={(e) => setN(e.target.value.length)} /></label>
      <p id="body-count" className="muted" data-tone={n > LIMIT ? 'amber' : undefined}>
        {n} of {LIMIT}. {n > LIMIT ? 'Over 320: this goes out as one line plus a link to the full message on the person’s page.' : 'Texts over 320 characters go out as one line plus a link.'}
      </p>
    </>
  );
}
