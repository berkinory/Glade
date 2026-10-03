import { providerAuthenticationRouteLayer } from "./providerAuthenticationRoute";
import type { ServerReadiness } from "../readiness";
import { type ServerShutdownController } from "../lifecycle/serverShutdown";
import { Layer } from "effect";
import {
  makeHealthEffectRouteLayer,
  makeDesktopShutdownEffectRouteLayer,
  makeDesktopComputerEmergencyStopRouteLayer,
} from "./lifecycleRoutes";
import { authEffectRouteLayer } from "./authRoutes";
import { projectFaviconEffectRouteLayer, siteFaviconEffectRouteLayer } from "./faviconRoutes";
import { threadExportEffectRouteLayer } from "./threadExportRoute";
import { editorIconEffectRouteLayer } from "./editorIconRoute";
import { localImageEffectRouteLayer, attachmentsEffectRouteLayer } from "./fileRoutes";
import { binaryUploadEffectRouteLayer } from "./binaryUploadRoutes";
import { staticAndDevEffectRouteLayer } from "./staticRoutes";

export function makeEffectHttpRouteLayer(
  readiness: ServerReadiness,
  shutdownController: ServerShutdownController,
) {
  return Layer.mergeAll(
    makeHealthEffectRouteLayer(readiness),
    makeDesktopShutdownEffectRouteLayer(shutdownController),
    makeDesktopComputerEmergencyStopRouteLayer(),
    authEffectRouteLayer,
    providerAuthenticationRouteLayer,
    projectFaviconEffectRouteLayer,
    threadExportEffectRouteLayer,
    siteFaviconEffectRouteLayer,
    editorIconEffectRouteLayer,
    localImageEffectRouteLayer,
    binaryUploadEffectRouteLayer,
    attachmentsEffectRouteLayer,
    staticAndDevEffectRouteLayer,
  );
}
