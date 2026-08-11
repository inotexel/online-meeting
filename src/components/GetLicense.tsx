import { Button } from "@/components";
import { useAuth } from "@/hooks";
import { ANALYTICS_EVENTS, captureEvent } from "@/lib";

/**
 * "Unlock Pro" button. Signed out → opens the browser sign-in flow (the
 * pluely:// deep link completes it); signed in but free → opens the pricing
 * page to subscribe. Keeps the old GetLicense name/props so existing call
 * sites don't change.
 */
export const GetLicense = ({
  setState,
  buttonText,
  buttonClassName = "",
}: {
  setState?: React.Dispatch<React.SetStateAction<boolean>>;
  buttonText?: string;
  buttonClassName?: string;
}) => {
  const { signed_in, loading, signIn } = useAuth();

  const handleClick = async () => {
    try {
      if (!signed_in) {
        await signIn(); // browser opens; deep link finishes the job
      } else {
        // Signed in but not entitled: subscribing happens on the web.
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl("https://pluely.com/pricing");
      }
      setState?.(false);
    } catch (err) {
      console.error("Sign-in failed to start:", err);
    } finally {
      await captureEvent(ANALYTICS_EVENTS.GET_LICENSE);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      size="sm"
      className={buttonClassName}
    >
      {buttonText || (signed_in ? "Upgrade" : "Sign in")}
    </Button>
  );
};
