# AquaFlow TIA Portal Openness bridge

This is the version-bound Windows companion used by AquaFlow for official Siemens engineering operations. It references the `Siemens.Engineering.dll` installed by TIA Portal; that proprietary assembly is never copied into this repository.

Requirements:

- Licensed STEP 7 Basic/Professional and the matching TIA Portal Openness option
- Visual Studio 2017 or later with .NET Framework 4.8 SDK to build
- Current Windows user in the local `Siemens TIA Openness` group
- Exact CPU/module `TypeIdentifier` values from the installed TIA hardware catalog

Build from an ordinary PowerShell prompt, for example:

```powershell
.\build.ps1 -PublicApi 'C:\Program Files\Siemens\Automation\Portal V20\PublicAPI\V20'
```

The first connection can display the Siemens Openness firewall prompt. Review and allow the exact built executable. Do not copy `Siemens.Engineering.dll` or bypass Siemens licensing/access protection.

The download callback deliberately leaves the CPU in STOP and aborts on any unhandled Siemens prompt, target mismatch, active test, password problem, or protection change. AquaFlow never selects a post-download RUN action.
