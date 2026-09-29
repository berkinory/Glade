import { ServiceMap } from "effect";

export type ManagedAttachmentPrincipal =
  | { readonly ownerKind: "session"; readonly ownerId: string }
  | { readonly ownerKind: "local-loopback"; readonly ownerId: "local-loopback" };

export const LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL: ManagedAttachmentPrincipal = {
  ownerKind: "local-loopback",
  ownerId: "local-loopback",
};

export const CurrentManagedAttachmentPrincipal = ServiceMap.Reference<ManagedAttachmentPrincipal>(
  "glade/attachments/CurrentManagedAttachmentPrincipal",
  { defaultValue: () => LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL },
);

export function attachmentPrincipalForSession(sessionId: string): ManagedAttachmentPrincipal {
  return { ownerKind: "session", ownerId: sessionId };
}
