!macro customHeader
  !ifdef BUILD_UNINSTALLER
    ShowUninstDetails show
  !else
    ShowInstDetails show
  !endif
!macroend

Section /o "Windows service runbook (advanced)" SEC_CODEXWINMUX_SERVICE_RUNBOOK
  DetailPrint "Windows service setup is default-off and runbook-first."
  FileOpen $0 "$INSTDIR\codexwinmux-service-runbook.txt" w
  FileWrite $0 "codexwinmux Windows service setup is default-off and runbook-first.$\r$\n"
  FileWrite $0 "Use an elevated PowerShell session and the project runbook scripts to migrate profile/data, ACL, credentials, and service logon.$\r$\n"
  FileWrite $0 "Required gates: account rotation, health, upgrade, uninstall, and reboot readiness.$\r$\n"
  FileClose $0
SectionEnd
