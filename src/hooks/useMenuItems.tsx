import {
  Settings,
  Code,
  MessagesSquare,
  WandSparkles,
  AudioLinesIcon,
  SquareSlashIcon,
  MonitorIcon,
  HomeIcon,
  PowerIcon,
  MessageSquareTextIcon,
  HistoryIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

/** Sidebar entries hidden until re-enabled. */
const HIDDEN_MENU_HREFS = new Set([
  "/transcripts",
  "/system-prompts",
  "/responses",
  "/screenshot",
  "/audio",
  "/shortcuts",
]);

export const useMenuItems = () => {
  const menu: {
    icon: React.ElementType;
    label: string;
    href: string;
    count?: number;
  }[] = [
    {
      icon: HomeIcon,
      label: "Dashboard",
      href: "/dashboard",
    },
    {
      icon: MessagesSquare,
      label: "Chats",
      href: "/chats",
    },
    {
      icon: HistoryIcon,
      label: "Transcriptions",
      href: "/transcripts",
    },
    {
      icon: WandSparkles,
      label: "System prompts",
      href: "/system-prompts",
    },
    {
      icon: Settings,
      label: "App Settings",
      href: "/settings",
    },
    {
      icon: MessageSquareTextIcon,
      label: "Responses",
      href: "/responses",
    },
    {
      icon: MonitorIcon,
      label: "Screenshot",
      href: "/screenshot",
    },
    {
      icon: AudioLinesIcon,
      label: "Audio",
      href: "/audio",
    },
    {
      icon: SquareSlashIcon,
      label: "Cursor & Shortcuts",
      href: "/shortcuts",
    },
    {
      icon: Code,
      label: "Dev space",
      href: "/dev-space",
    },
  ].filter((item) => !HIDDEN_MENU_HREFS.has(item.href));

  const footerItems = [
    {
      icon: PowerIcon,
      label: "Quit app",
      action: async () => {
        await invoke("exit_app");
      },
    },
  ];

  const footerLinks: {
    title: string;
    icon: React.ElementType;
    link: string;
  }[] = [];

  return {
    menu,
    footerItems,
    footerLinks,
  };
};
