export async function preloadLazyChunks(): Promise<void> {
  await Promise.all([
    import('../components/Editor'),
    import('../components/SettingsModal'),
    import('../components/OnboardingWizard'),
    import('../components/DonateNudgeModal'),
    import('../components/WhatsNewModal'),
    import('../components/HelpModal'),
    import('../components/LoudnessHelpModal'),
    import('../components/FindReplaceModal'),
    import('../components/StripNumberingModal'),
    import('../components/RenameModal'),
    import('../components/InfoModal'),
    import('../components/ExportModal'),
    import('../components/CommandPalette'),
  ])
}
