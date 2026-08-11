"use client";

import { useActionState } from "react";
import { removeDevice, type FormState } from "@/lib/actions";

const initial: FormState = { error: null };

export function DeviceRow({
  id,
  name,
  platform,
  appVersion,
  lastSeenAt,
}: {
  id: string;
  name: string;
  platform: string | null;
  appVersion: string | null;
  lastSeenAt: string;
}) {
  const [state, action, pending] = useActionState(removeDevice, initial);

  return (
    <li className="flex items-center justify-between gap-4 py-3 text-sm">
      <div>
        <p className="font-medium">
          {name}
          {platform && <span className="ml-2 font-normal text-mute">{platform}</span>}
        </p>
        <p className="text-xs text-mute">
          {appVersion ? `v${appVersion} · ` : ""}
          last seen {new Date(lastSeenAt).toLocaleString()}
        </p>
        {state.error && <p role="alert" className="text-xs text-red-600">{state.error}</p>}
      </div>
      <form action={action}>
        <input type="hidden" name="device_id" value={id} />
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-full border border-line px-4 py-1.5 text-xs transition-colors hover:border-mute disabled:opacity-60"
        >
          {pending ? "Removing…" : "Remove"}
        </button>
      </form>
    </li>
  );
}
