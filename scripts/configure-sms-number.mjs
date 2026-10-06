// This helper previously rewired a shared Vapi number. Production routing is
// now an explicit dedicated-SMS operation, verified by the launch checklist.
console.error("Retired shared-number helper. Configure the dedicated Mio SMS number/Messaging Service explicitly, then run pnpm launch:check. See docs/LAUNCH.md.");
process.exitCode = 1;
