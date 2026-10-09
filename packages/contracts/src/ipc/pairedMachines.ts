// Another machine's Glade this app paired with through a link from that machine's Settings →
// Remote access. The app reaches it over the network, unlike an SSH host it starts itself.
export interface DesktopPairedMachine {
  readonly id: string;
  readonly label: string;
  readonly environmentId: string;
  // The address the machine was last reached at, for display.
  readonly address: string;
}
