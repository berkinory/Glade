import { memo } from "react";
import type { MessagesTimelineProps } from "./timeline/timelineSupport";
import { useTimelineController } from "./timeline/useTimelineController";
import { TimelineControllerSurface } from "./timeline/TimelineControllerSurface";
export const MessagesTimeline = memo(function MessagesTimeline(props: MessagesTimelineProps) {
  const controller = useTimelineController(props);
  return <TimelineControllerSurface controller={controller} />;
});
