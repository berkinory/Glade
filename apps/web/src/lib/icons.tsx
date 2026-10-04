import { type CSSProperties, type FC, type SVGProps } from "react";
import { PiSquareSplitHorizontal, PiSquareSplitVertical } from "react-icons/pi";
import { RiApps2Line } from "react-icons/ri";
import { SiGithub } from "react-icons/si";
import { VscMcp } from "react-icons/vsc";
import { CentralIcon, type CentralIconVariant } from "./central-icons";
import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconArchive,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconArrowUpRight,
  IconBolt,
  IconBrain,
  IconBulb,
  IconBug,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconCircleCheck,
  IconDots,
  IconDownload,
  IconExternalLink,
  IconEye,
  IconFile,
  IconFlag,
  IconFolder,
  IconFolderOpen,
  IconHistory,
  IconInfoCircle,
  IconListCheck,
  IconListDetails,
  IconMaximize,
  IconMinimize,
  IconMinus,
  IconDeviceDesktop,
  IconDeviceLaptop,
  IconMessageCircle,
  IconMoon,
  IconPaperclip,
  IconPlus,
  IconRefresh,
  IconRotate2,
  IconSelector,
  IconStar,
  IconStarFilled,
  IconSun,
  IconTextWrap,
  IconTrash,
  IconX,
  type TablerIcon,
} from "@tabler/icons-react";

export type LucideIcon = FC<SVGProps<SVGSVGElement>>;

function adaptIcon(Component: TablerIcon): LucideIcon {
  return function AdaptedIcon(props) {
    return <Component {...(props as any)} />;
  };
}

function centralIconWrapper(name: string, variant?: CentralIconVariant): LucideIcon {
  return function CentralIconWrapper({ className, style, ...rest }) {
    const ariaLabelRaw = (rest as { ["aria-label"]?: unknown })["aria-label"];
    const label = typeof ariaLabelRaw === "string" ? ariaLabelRaw : undefined;
    return (
      <CentralIcon
        name={name}
        variant={variant}
        className={typeof className === "string" ? className : undefined}
        style={style as CSSProperties | undefined}
        label={label}
      />
    );
  };
}

export const AppsIcon: LucideIcon = (props) => (
  <RiApps2Line className={props.className} style={props.style} />
);

export const BackgroundTrayIcon: LucideIcon = centralIconWrapper("arrow-down-wall");
export const ContextCompactionIcon: LucideIcon = centralIconWrapper("arrows-hide");
export const ComputerUseIcon: LucideIcon = centralIconWrapper("cursor-1");
export const PanelExpandIcon: LucideIcon = centralIconWrapper("expand-45");
export const PanelCollapseIcon: LucideIcon = centralIconWrapper("minimize-45");
export const BackToParentIcon: LucideIcon = centralIconWrapper("arrow-share-left");
export const WorkflowIcon: LucideIcon = centralIconWrapper("agents");
export const SteerIcon: LucideIcon = centralIconWrapper("arrow-corner-down-right");
export const ComposerSendArrowIcon: LucideIcon = centralIconWrapper("arrow-up");
export const HANDOFF_ICON_NAME = "arrow-left-right";
export const HandoffIcon: LucideIcon = centralIconWrapper(HANDOFF_ICON_NAME);
export const SkillCubeIcon: LucideIcon = centralIconWrapper("building-blocks");
export const NewThreadIcon: LucideIcon = centralIconWrapper("compose-pencil");

export const FolderAddIcon: LucideIcon = centralIconWrapper("folder-add-left");
export const FolderOpenFrontIcon: LucideIcon = centralIconWrapper("folder-open-front");
export const UsageGaugeIcon: LucideIcon = centralIconWrapper("gauge");
export const BugReportIcon: LucideIcon = centralIconWrapper("bug");

export const AddPlusIcon: LucideIcon = centralIconWrapper("plus-medium");
export const EraserIcon: LucideIcon = centralIconWrapper("eraser");
export const ArrowLeftIcon = adaptIcon(IconArrowLeft);
export const ArrowRightIcon = adaptIcon(IconArrowRight);
export const ArrowDownIcon = adaptIcon(IconArrowDown);
export const ArrowUpIcon = adaptIcon(IconArrowUp);
export const ArrowUpRightIcon = adaptIcon(IconArrowUpRight);
export const SortIcon: LucideIcon = centralIconWrapper("arrow-top-bottom");

export const AGENT_ROBOT_ICON_NAME = "robot";
export const BotIcon: LucideIcon = centralIconWrapper(AGENT_ROBOT_ICON_NAME);
export const BookOpenIcon: LucideIcon = centralIconWrapper("newspaper-2");
export const BugIcon = adaptIcon(IconBug);
export const CameraIcon = adaptIcon(IconCamera);
export const CheckIcon = adaptIcon(IconCheck);
export const ChevronDownIcon = adaptIcon(IconChevronDown);
export const ChevronLeftIcon = adaptIcon(IconChevronLeft);
export const ChevronRightIcon = adaptIcon(IconChevronRight);
export const ChevronUpIcon = adaptIcon(IconChevronUp);
export const ChevronsUpDownIcon = adaptIcon(IconSelector);
export const CircleAlertIcon = adaptIcon(IconAlertCircle);
export const OctagonAlertIcon = adaptIcon(IconAlertOctagon);
export const CircleCheckIcon = adaptIcon(IconCircleCheck);

export const CircleQuestionIcon: LucideIcon = centralIconWrapper("circle-questionmark");
export const ArrowUpCircleIcon: LucideIcon = centralIconWrapper("arrow-up-circle");
export const CloudSyncIcon = centralIconWrapper("cloud-sync");
export const ChangesIcon = centralIconWrapper("changes");
export const COPY_ICON_NAME = "square-behind-square-6";
export const CopyIcon = centralIconWrapper(COPY_ICON_NAME);
export const LightbulbIcon = adaptIcon(IconBulb);

export const DownloadIcon = adaptIcon(IconDownload);

export const BELL_ICON_NAME = "notes";
export const BellIcon: LucideIcon = centralIconWrapper(BELL_ICON_NAME);
export const EllipsisIcon = adaptIcon(IconDots);
export const ExternalLinkIcon = adaptIcon(IconExternalLink);
export const EyeIcon = adaptIcon(IconEye);

export const CodeIcon: LucideIcon = centralIconWrapper("code");
export const EYE_OPEN_ICON_NAME = "eye-open";
export const EyeOpenIcon: LucideIcon = centralIconWrapper(EYE_OPEN_ICON_NAME);
export const PaperclipIcon = adaptIcon(IconPaperclip);
export const ArchiveIcon = adaptIcon(IconArchive);
export const BrainIcon = adaptIcon(IconBrain);
export const FileIcon = adaptIcon(IconFile);
export const FlagIcon = adaptIcon(IconFlag);
export const FolderIcon = adaptIcon(IconFolder);
export const FolderOpenIcon = adaptIcon(IconFolderOpen);

export const FoldersIcon: LucideIcon = centralIconWrapper("folders");
export const GiftIcon: LucideIcon = centralIconWrapper("gift-2");
export const GitCommitIcon: LucideIcon = centralIconWrapper("commits");
export const GitBranchIcon: LucideIcon = centralIconWrapper("branch");

export const GitMergeIcon: LucideIcon = centralIconWrapper("merged");
export const GitMergedSimpleIcon: LucideIcon = centralIconWrapper("merged-simple");
export const PushIcon: LucideIcon = centralIconWrapper("cloud-simple-upload");
export const GitHubIcon: LucideIcon = (props) => (
  <SiGithub className={props.className} style={props.style} />
);
export const GitPullRequestIcon = centralIconWrapper("pull-request");

export const GitPullRequestDraftIcon: LucideIcon = centralIconWrapper("draft");
export const GitPullRequestClosedIcon: LucideIcon = centralIconWrapper("request-closed");
export const GitMergeConflictIcon: LucideIcon = centralIconWrapper("merge-conflict");

export const GlobeIcon: LucideIcon = centralIconWrapper("globe");

export const McpIcon: LucideIcon = (props) => (
  <VscMcp className={props.className} style={props.style} />
);
export const PluginIcon: LucideIcon = centralIconWrapper("puzzle");

export const HammerIcon: LucideIcon = centralIconWrapper("hammer");
export const HistoryIcon = adaptIcon(IconHistory);
export const InfoIcon = adaptIcon(IconInfoCircle);
export const KeyboardIcon: LucideIcon = centralIconWrapper("keyboard");
export const ListChecksIcon = adaptIcon(IconListCheck);
export const ListTodoIcon = adaptIcon(IconListDetails);
export const Maximize2 = adaptIcon(IconMaximize);
export const Minimize2 = adaptIcon(IconMinimize);
export const MessageCircleIcon = adaptIcon(IconMessageCircle);
export const MinusIcon = adaptIcon(IconMinus);
export const ChatBubbleIcon: LucideIcon = centralIconWrapper("bubble-text");
export const NewChatIcon: LucideIcon = centralIconWrapper("chat-bubble-7");
export const MicIcon: LucideIcon = centralIconWrapper("microphone");
export const PanelLeftIcon = centralIconWrapper("sidebar-simple-left-wide");
export const PanelRightCloseIcon = centralIconWrapper("sidebar-simple-right-wide");
export const WindowIcon: LucideIcon = centralIconWrapper("window");
export const LayoutSidebarIcon: LucideIcon = centralIconWrapper("layout-sidebar");
export const PENCIL_ICON_NAME = "pencil";
export const PencilIcon: LucideIcon = centralIconWrapper(PENCIL_ICON_NAME);
export const PIN_ICON_NAME = "pin";
export const PinIcon: LucideIcon = centralIconWrapper(PIN_ICON_NAME);

export const PinFilledIcon: LucideIcon = centralIconWrapper("pin", "fill");
export const PauseIcon: LucideIcon = centralIconWrapper("pause", "fill");
export const PlayIcon: LucideIcon = centralIconWrapper("play", "fill");

export const PlusIcon = adaptIcon(IconPlus);
export const RefreshCwIcon = adaptIcon(IconRefresh);
export const RotateCcwIcon = adaptIcon(IconRotate2);
export const SearchIcon: LucideIcon = centralIconWrapper("magnifying-glass");

export const SettingsIcon: LucideIcon = centralIconWrapper("settings-gear-4");
export const StarIcon = adaptIcon(IconStar);
export const StarFilledIcon = adaptIcon(IconStarFilled);
export const SunIcon = adaptIcon(IconSun);
export const MoonIcon = adaptIcon(IconMoon);
export const DeviceLaptopIcon = adaptIcon(IconDeviceLaptop);
export const MonitorIcon = adaptIcon(IconDeviceDesktop);
export const StopIcon: LucideIcon = centralIconWrapper("stop", "fill");
export const StopFilledIcon: LucideIcon = centralIconWrapper("stop", "fill");
export const SquareSplitHorizontal: LucideIcon = (props) => (
  <PiSquareSplitHorizontal className={props.className} style={props.style} />
);
export const SquareSplitVertical: LucideIcon = (props) => (
  <PiSquareSplitVertical className={props.className} style={props.style} />
);
export const TERMINAL_ICON_NAME = "console";
export const TerminalIcon = centralIconWrapper(TERMINAL_ICON_NAME);
export const TerminalSquare = centralIconWrapper("console");
export const TextWrapIcon = adaptIcon(IconTextWrap);
export const Trash2 = adaptIcon(IconTrash);
export const TriangleAlertIcon = adaptIcon(IconAlertTriangle);
export const Undo2Icon = adaptIcon(IconArrowBackUp);

export const ResetIcon: LucideIcon = centralIconWrapper("arrow-rotate-counter-clockwise");
export const WorktreeIcon = centralIconWrapper("arrow-split-right");
export const XIcon = adaptIcon(IconX);
export const ZapIcon = adaptIcon(IconBolt);

export const FastModeIcon: LucideIcon = centralIconWrapper("zap", "fill");
