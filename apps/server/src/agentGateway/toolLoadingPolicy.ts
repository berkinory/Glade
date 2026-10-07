const AUTO_LOAD_TOOLS = new Set([
  "glade_context",
  "glade_capabilities",
  "glade_interrupt_thread",
  "glade_set_thread_title",
  "glade_diagnose_thread",
  "glade_open_in_app",
  "glade_read_turn_diff",
  "glade_read_thread_diff",
  "glade_read_thread_runtime_events",
  // The core browser loop, reading and scrolling included (about 410 schema tokens for the two,
  // less than one tool search round trip); the rest of browser_* stays behind tool search.
  "browser_navigate",
  "browser_snapshot",
  "browser_find",
  "browser_get_text",
  "browser_click",
  "browser_type",
  "browser_fill",
  "browser_scroll",
]);

export function shouldAutoLoadTool(name: string): boolean {
  return AUTO_LOAD_TOOLS.has(name);
}
