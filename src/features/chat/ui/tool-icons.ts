// Phosphor icon per tool-icon key (the pure view-model picks the KEY — see
// `logic/tool-summary.ts` `toolIcon`; this is the only place that knows the
// concrete components). Deep imports (`phosphor-svelte/lib/<Name>Icon`) on
// purpose: the package root re-exports ~1,500 components, and Svelte libraries
// are not prebundled in dev, so a root import would load every one of them.

import ArrowSquareOutIcon from "phosphor-svelte/lib/ArrowSquareOutIcon";
import BookOpenIcon from "phosphor-svelte/lib/BookOpenIcon";
import BracketsCurlyIcon from "phosphor-svelte/lib/BracketsCurlyIcon";
import ChatCircleTextIcon from "phosphor-svelte/lib/ChatCircleTextIcon";
import CpuIcon from "phosphor-svelte/lib/CpuIcon";
import EyeIcon from "phosphor-svelte/lib/EyeIcon";
import FileTextIcon from "phosphor-svelte/lib/FileTextIcon";
import FloppyDiskIcon from "phosphor-svelte/lib/FloppyDiskIcon";
import ImageIcon from "phosphor-svelte/lib/ImageIcon";
import ListChecksIcon from "phosphor-svelte/lib/ListChecksIcon";
import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";
import PaperPlaneTiltIcon from "phosphor-svelte/lib/PaperPlaneTiltIcon";
import PencilSimpleIcon from "phosphor-svelte/lib/PencilSimpleIcon";
import ProhibitIcon from "phosphor-svelte/lib/ProhibitIcon";
import PuzzlePieceIcon from "phosphor-svelte/lib/PuzzlePieceIcon";
import RobotIcon from "phosphor-svelte/lib/RobotIcon";
import TerminalWindowIcon from "phosphor-svelte/lib/TerminalWindowIcon";
import UsersThreeIcon from "phosphor-svelte/lib/UsersThreeIcon";
import WrenchIcon from "phosphor-svelte/lib/WrenchIcon";
import YoutubeLogoIcon from "phosphor-svelte/lib/YoutubeLogoIcon";
import type { Component } from "svelte";
import type { ToolIconKey } from "../logic/tool-summary";

// biome-ignore lint/suspicious/noExplicitAny: Phosphor's IconComponentProps is internal; any icon accepts size/class.
export const TOOL_ICON_COMPONENTS: Readonly<Record<ToolIconKey, Component<any>>> = {
  terminal: TerminalWindowIcon,
  "file-read": FileTextIcon,
  "file-edit": PencilSimpleIcon,
  "file-write": FloppyDiskIcon,
  search: MagnifyingGlassIcon,
  code: BracketsCurlyIcon,
  todos: ListChecksIcon,
  skill: BookOpenIcon,
  vision: EyeIcon,
  image: ImageIcon,
  youtube: YoutubeLogoIcon,
  "agent-summon": RobotIcon,
  "agent-send": PaperPlaneTiltIcon,
  "agent-read": ChatCircleTextIcon,
  "agent-open": ArrowSquareOutIcon,
  "agent-cancel": ProhibitIcon,
  agents: UsersThreeIcon,
  models: CpuIcon,
  mcp: PuzzlePieceIcon,
  tool: WrenchIcon,
};
