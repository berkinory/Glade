import ApplicationServices
import CoreGraphics

enum ComputerPermission: String {
    case accessibility
    case inputMonitoring
    case screenRecording
}

struct ComputerPermissionState {
    let accessibility: Bool?
    let inputMonitoring: Bool?
    let screenRecording: Bool?
}

func preflightComputerPermissions(_ permissions: Set<ComputerPermission>) -> ComputerPermissionState {
    ComputerPermissionState(
        accessibility: permissions.contains(.accessibility) ? AXIsProcessTrusted() : nil,
        inputMonitoring: permissions.contains(.inputMonitoring) ? CGPreflightListenEventAccess() : nil,
        screenRecording: permissions.contains(.screenRecording) ? CGPreflightScreenCaptureAccess() : nil
    )
}

func requestComputerPermissions(_ permissions: Set<ComputerPermission>) -> ComputerPermissionState {
    let preflight = preflightComputerPermissions(permissions)
    if preflight.accessibility == false {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        _ = AXIsProcessTrustedWithOptions(options as CFDictionary)
    }
    if preflight.screenRecording == false {
        _ = CGRequestScreenCaptureAccess()
    }
    if preflight.inputMonitoring == false {
        _ = CGRequestListenEventAccess()
    }
    return preflightComputerPermissions(permissions)
}
