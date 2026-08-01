import type { SVGProps } from "react";

export type UiIconName =
  | "atom"
  | "home"
  | "folder"
  | "message"
  | "panels"
  | "brain"
  | "history"
  | "sparkles"
  | "github"
  | "bell"
  | "arrow-right"
  | "arrow-up"
  | "plus"
  | "trash"
  | "clock"
  | "gamepad"
  | "bot"
  | "code"
  | "play"
  | "list"
  | "download"
  | "chevron-down"
  | "check-circle"
  | "lightbulb"
  | "briefcase"
  | "folder-heart";

type UiIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: UiIconName;
};

export default function UiIcon({ name, ...props }: UiIconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {name === "atom" ? (
        <>
          <circle cx="12" cy="12" r="1.5" />
          <path d="M19.4 15c2.1 3.7 1.2 5.5-.8 5.5-3.2 0-8.1-4-10.9-8.8S4 2.7 5.8 1.7C7.6.6 12.2 4 15.1 9" />
          <path d="M8.9 9c2.9-5 7.5-8.4 9.3-7.3 1.8 1 1 5.1-1.8 9.9-2.8 4.9-7.7 8.9-10.9 8.9-2 0-2.9-1.8-.8-5.5" />
          <path d="M5 8.2C.8 8.2.1 10.2 1.2 12c1.6 2.8 7.5 4.7 13.1 4.7s9.6-1.8 9.6-3.8c0-2.1-3.9-3.8-9.6-3.8" />
        </>
      ) : null}
      {name === "home" ? <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></> : null}
      {name === "folder" ? <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" /></> : null}
      {name === "message" ? <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /><path d="M8 9h8M8 13h5" /></> : null}
      {name === "panels" ? <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></> : null}
      {name === "brain" ? <><path d="M9.5 4.5A3 3 0 0 0 4 6a3 3 0 0 0 .5 5.5A3 3 0 0 0 6 17a3 3 0 0 0 5.5 1.5V5.5A3 3 0 0 0 9.5 4.5Z" /><path d="M14.5 4.5A3 3 0 0 1 20 6a3 3 0 0 1-.5 5.5A3 3 0 0 1 18 17a3 3 0 0 1-5.5 1.5V5.5a3 3 0 0 1 2-1Z" /><path d="M8 10h3.5M16 10h-3.5M8 14h3.5M16 14h-3.5" /></> : null}
      {name === "history" ? <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></> : null}
      {name === "sparkles" ? <><path d="m12 3 1.2 3.1L16 7.5l-2.8 1.4L12 12l-1.2-3.1L8 7.5l2.8-1.4z" /><path d="m18.5 13 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8zM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8z" /></> : null}
      {name === "github" ? <path d="M15 22v-3.9c0-1 .1-1.4-.5-2 3.3-.4 6.8-1.6 6.8-7.3A5.7 5.7 0 0 0 19.8 5 5.3 5.3 0 0 0 19.6 1S18.4.6 15 2.5a13.4 13.4 0 0 0-6 0C5.6.6 4.4 1 4.4 1A5.3 5.3 0 0 0 4.2 5a5.7 5.7 0 0 0-1.5 3.8c0 5.7 3.5 6.9 6.8 7.3-.5.5-.6 1.1-.6 2V22M9 19c-3 .9-3-1.5-4.2-2" /> : null}
      {name === "bell" ? <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></> : null}
      {name === "arrow-right" ? <><path d="M5 12h14M13 6l6 6-6 6" /></> : null}
      {name === "arrow-up" ? <><path d="M12 19V5M6 11l6-6 6 6" /></> : null}
      {name === "plus" ? <><path d="M12 5v14M5 12h14" /></> : null}
      {name === "trash" ? <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></> : null}
      {name === "clock" ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> : null}
      {name === "gamepad" ? <><path d="M8 8h8a5 5 0 0 1 4.8 6.4l-.8 2.8a2.5 2.5 0 0 1-4.2 1L14 16h-4l-1.8 2.2a2.5 2.5 0 0 1-4.2-1l-.8-2.8A5 5 0 0 1 8 8Z" /><path d="M7 12v4M5 14h4M16 13h.01M18 15h.01" /></> : null}
      {name === "bot" ? <><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8" /></> : null}
      {name === "code" ? <><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" /></> : null}
      {name === "play" ? <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4z" /></> : null}
      {name === "list" ? <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m4 6 1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></> : null}
      {name === "download" ? <><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></> : null}
      {name === "chevron-down" ? <path d="m6 9 6 6 6-6" /> : null}
      {name === "check-circle" ? <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></> : null}
      {name === "lightbulb" ? <><path d="M9 18h6M10 22h4M8.5 15.5A7 7 0 1 1 15.5 15.5L14 18h-4z" /></> : null}
      {name === "briefcase" ? <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2" /></> : null}
      {name === "folder-heart" ? <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 16s-3-1.7-3-4a1.8 1.8 0 0 1 3-1.3 1.8 1.8 0 0 1 3 1.3c0 2.3-3 4-3 4Z" /></> : null}
    </svg>
  );
}
