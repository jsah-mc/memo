import { BlocksIcon } from "lucide-react";
import type { IconType } from "react-icons";
import { FaSlack } from "react-icons/fa6";
import {
  SiDiscord,
  SiDropbox,
  SiGithub,
  SiGmail,
  SiGooglecalendar,
  SiGoogledrive,
  SiJira,
  SiLinear,
  SiNotion,
} from "react-icons/si";

const ICONS: Readonly<Record<string, IconType>> = {
  github: SiGithub,
  gmail: SiGmail,
  googlecalendar: SiGooglecalendar,
  googledrive: SiGoogledrive,
  slack: FaSlack,
  notion: SiNotion,
  linear: SiLinear,
  jira: SiJira,
  discord: SiDiscord,
  dropbox: SiDropbox,
};

export function ComposioIcon({
  toolkit,
  className = "size-5",
}: Readonly<{ toolkit: string; className?: string }>) {
  const Icon = ICONS[toolkit.toLowerCase().replaceAll("_", "")];
  return Icon ? (
    <Icon aria-hidden="true" className={className} />
  ) : (
    <BlocksIcon aria-hidden="true" className={className} />
  );
}
