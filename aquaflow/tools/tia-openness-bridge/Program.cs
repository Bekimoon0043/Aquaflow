using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Xml.Linq;
using Siemens.Engineering;
using Siemens.Engineering.Compiler;
using Siemens.Engineering.Connection;
using Siemens.Engineering.Download;
using Siemens.Engineering.HW;
using Siemens.Engineering.HW.Features;
using Siemens.Engineering.Online;
using Siemens.Engineering.SW;
using Siemens.Engineering.SW.Blocks;
using Siemens.Engineering.SW.ExternalSources;

namespace AquaFlow.TiaBridge
{
    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private static Dictionary<string, object> Request;
        private static string Password;

        [STAThread]
        private static int Main(string[] args)
        {
            string requestPath = Arg(args, "--request"), responsePath = Arg(args, "--response");
            var response = new Dictionary<string, object>();
            try
            {
                Request = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(requestPath));
                Password = Get("password", "");
                string operation = Get("operation", "");
                if (operation == "status") response = Status();
                else if (operation == "generate") response = Generate();
                else if (operation == "compile") response = CompileProject();
                else if (operation == "download") response = DownloadProject();
                else if (operation == "diagnostics") response = Diagnostics();
                else throw new ArgumentException("Unsupported operation");
                response["ok"] = true;
            }
            catch (Exception ex)
            {
                response = new Dictionary<string, object> { { "ok", false }, { "error", ex.Message }, { "exception", ex.GetType().FullName } };
            }
            finally { Password = null; }
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(responsePath)));
            File.WriteAllText(responsePath, Json.Serialize(response));
            return response.ContainsKey("ok") && (bool)response["ok"] ? 0 : 1;
        }

        private static Dictionary<string, object> Status()
        {
            int apiMajor = EngineeringApiMajor();
            var apiFile = FileVersionInfo.GetVersionInfo(typeof(TiaPortal).Assembly.Location);
            return new Dictionary<string, object> {
                { "bridge", typeof(Program).Assembly.GetName().Version.ToString() },
                { "engineering_assembly", typeof(TiaPortal).Assembly.FullName },
                { "engineering_assembly_path", typeof(TiaPortal).Assembly.Location },
                { "engineering_file_version", apiFile.FileVersion },
                { "supported_tia_versions", new object[] { apiMajor } },
                { "capabilities", new Dictionary<string, object> {
                    { "project", true }, { "compile", true }, { "download", true }, { "diagnostics", true },
                    { "cyclic_ob_generation", true }, { "cyclic_ob_verification", true }
                }}
            };
        }

        private static Dictionary<string, object> Generate()
        {
            AssertTiaVersion();
            string projectDir = Path.GetFullPath(Get("project_dir"));
            if (Directory.Exists(projectDir) && Directory.EnumerateFileSystemEntries(projectDir).Any())
                throw new InvalidOperationException("TIA project directory already exists and is not empty");
            Directory.CreateDirectory(projectDir);
            using (var portal = new TiaPortal(TiaPortalMode.WithUserInterface))
            using (Project project = portal.Projects.Create(new DirectoryInfo(projectDir), Get("project_name")))
            {
                Device device = project.Devices.CreateWithItem(Get("cpu_type_identifier"), Get("cpu_name"), Get("device_name"));
                VerifyCpu(device);
                foreach (var module in Modules())
                {
                    if (!device.CanPlugNew(module.TypeIdentifier, module.Name, module.Position))
                        throw new InvalidOperationException("TIA catalog cannot plug module " + module.Name + " at position " + module.Position);
                    device.PlugNew(module.TypeIdentifier, module.Name, module.Position);
                }
                PlcSoftware plc = FindPlcSoftware(device);
                if (plc == null) throw new InvalidOperationException("Created device has no PLC software container");
                string sources = Path.GetFullPath(Get("sources_dir"));
                foreach (string filename in new[] { "AquaFlowSiteIO.db", "AquaFlowSiteControl.scl" })
                {
                    var file = new FileInfo(Path.Combine(sources, filename));
                    if (!file.Exists) throw new FileNotFoundException("Generated AquaFlow source is missing", file.FullName);
                    PlcExternalSource old = plc.ExternalSourceGroup.ExternalSources.Find(filename);
                    if (old != null) old.Delete();
                    PlcExternalSource source = plc.ExternalSourceGroup.ExternalSources.CreateFromFile(filename, file);
                    source.GenerateBlocksFromSource();
                }
                PlcBlock io = plc.BlockGroup.Blocks.Find("AquaFlowSiteIO");
                if (io == null) throw new InvalidOperationException("Generated AquaFlowSiteIO DB was not created");
                if (Convert.ToBoolean(io.GetAttribute("AutoNumber"))) io.SetAttribute("AutoNumber", false);
                io.SetAttribute("Number", GetInt("db_number"));
                VerifyIoBlock(plc);
                Dictionary<string, object> cycle = GenerateCyclicInterruptOb(plc, sources);
                project.Save();
                return new Dictionary<string, object> {
                    { "bridge", typeof(Program).Assembly.GetName().Version.ToString() },
                    { "project_path", project.Path.FullName },
                    { "program_validation", cycle },
                    { "diagnostics", new object[] { new Dictionary<string, object> {
                        { "severity", "information" }, { "message", "AquaFlowCycle was generated through version-native Siemens SimaticML and verified as a 100-ms cyclic interrupt before the project was saved." }
                    }}}
                };
            }
        }

        private static Dictionary<string, object> CompileProject()
        {
            AssertTiaVersion();
            using (var portal = new TiaPortal(TiaPortalMode.WithUserInterface))
            using (Project project = portal.Projects.Open(new FileInfo(Get("project_path"))))
            {
                Device device = project.Devices.Find(Get("device_name"));
                if (device == null) throw new InvalidOperationException("Configured device is absent from the TIA project");
                VerifyCpu(device);
                PlcSoftware plc = FindPlcSoftware(device);
                if (plc == null) throw new InvalidOperationException("PLC software was not found");
                Dictionary<string, object> validation = VerifyProgram(plc);
                CompilerResult result = device.GetService<ICompilable>().Compile();
                var diagnostics = new List<object>(); CollectCompiler(result.Messages, diagnostics);
                RefuseCompilerErrors(result);
                project.Save();
                return new Dictionary<string, object> { { "bridge", typeof(Program).Assembly.GetName().Version.ToString() },
                    { "project_path", project.Path.FullName }, { "state", result.State.ToString() },
                    { "error_count", result.ErrorCount }, { "warning_count", result.WarningCount },
                    { "program_validation", validation }, { "diagnostics", diagnostics } };
            }
        }

        private static Dictionary<string, object> DownloadProject()
        {
            AssertTiaVersion();
            if (GetBool("start_after_download")) throw new InvalidOperationException("AquaFlow never starts a CPU after download");
            using (var portal = new TiaPortal(TiaPortalMode.WithUserInterface))
            using (Project project = portal.Projects.Open(new FileInfo(Get("project_path"))))
            {
                Device device = project.Devices.Find(Get("device_name"));
                if (device == null) throw new InvalidOperationException("Configured device is absent from the TIA project");
                VerifyCpu(device);
                PlcSoftware plc = FindPlcSoftware(device);
                if (plc == null) throw new InvalidOperationException("PLC software was not found");
                Dictionary<string, object> validation = VerifyProgram(plc);
                // Recompile the project opened for this exact download.  A persisted earlier
                // compile result is never enough after a project could have been edited in TIA.
                CompilerResult compile = device.GetService<ICompilable>().Compile();
                RefuseCompilerErrors(compile);
                project.Save();
                DeviceItem target = FindDownloadTarget(device);
                DownloadProvider provider = target == null ? null : target.GetService<DownloadProvider>();
                if (provider == null) throw new InvalidOperationException("TIA did not expose a download provider for this CPU");
                ConfigurationMode mode = provider.Configuration.Modes.Find("PN/IE");
                if (mode == null) throw new InvalidOperationException("PN/IE download mode is unavailable");
                string interfaceName = Get("network_interface", "");
                ConfigurationPcInterface pc = string.IsNullOrWhiteSpace(interfaceName) ? mode.PcInterfaces.FirstOrDefault() : mode.PcInterfaces.Find(interfaceName, 1);
                if (pc == null || pc.TargetInterfaces.Count == 0) throw new InvalidOperationException("Selected Siemens PG/PC network interface is unavailable");
                ConfigurationTargetInterface targetInterface = pc.TargetInterfaces[0];
                ConfigurationAddress address = targetInterface.Addresses.Create(Get("target_ip"));
                DownloadResult result = provider.Download(targetInterface, address, PreDownload, PostDownload,
                    DownloadOptions.Hardware | DownloadOptions.Software);
                if (result.State == DownloadResultState.Error || result.ErrorCount > 0)
                    throw new InvalidOperationException("Siemens download failed with " + result.ErrorCount + " error(s)");
                var diagnostics = new List<object>();
                CollectCompiler(compile.Messages, diagnostics);
                diagnostics.Add(new Dictionary<string, object> { { "severity", result.State.ToString() }, { "message", "TIA download finished; CPU intentionally left in STOP" } });
                return new Dictionary<string, object> { { "bridge", typeof(Program).Assembly.GetName().Version.ToString() },
                    { "state", result.State.ToString() }, { "pre_download_compile_state", compile.State.ToString() },
                    { "pre_download_compile_errors", compile.ErrorCount }, { "program_validation", validation },
                    { "diagnostics", diagnostics } };
            }
        }

        private static Dictionary<string, object> Diagnostics()
        {
            AssertTiaVersion();
            using (var portal = new TiaPortal(TiaPortalMode.WithUserInterface))
            using (Project project = portal.Projects.Open(new FileInfo(Get("project_path"))))
            {
                Device device = project.Devices.Find(Get("device_name"));
                if (device != null) VerifyCpu(device);
                DeviceItem target = device == null ? null : FindDownloadTarget(device);
                OnlineProvider online = target == null ? null : target.GetService<OnlineProvider>();
                if (online == null) throw new InvalidOperationException("TIA did not expose an online provider for this CPU");
                return new Dictionary<string, object> { { "bridge", typeof(Program).Assembly.GetName().Version.ToString() },
                    { "online_state", online.State.ToString() }, { "diagnostics", new object[] {
                        new Dictionary<string, object> { { "severity", "information" }, { "message", "TIA online state: " + online.State } }
                    }} };
            }
        }

        private static void PreDownload(DownloadConfiguration c)
        {
            if (c is StopModules) { ((StopModules)c).CurrentSelection = StopModulesSelections.StopAll; return; }
            if (c is CheckBeforeDownload) { ((CheckBeforeDownload)c).Checked = true; return; }
            if (c is ConsistentBlocksDownload) { ((ConsistentBlocksDownload)c).CurrentSelection = ConsistentBlocksDownloadSelections.ConsistentDownload; return; }
            if (c is AllBlocksDownload) { ((AllBlocksDownload)c).CurrentSelection = AllBlocksDownloadSelections.DownloadAllBlocks; return; }
            if (c is OverwriteSystemData) { ((OverwriteSystemData)c).CurrentSelection = OverwriteSystemDataSelections.Overwrite; return; }
            if (c is ExpandDownload) { ((ExpandDownload)c).CurrentSelection = ExpandDownloadSelections.Download; return; }
            if (c is TargetForSoftware) { ((TargetForSoftware)c).CurrentSelection = TargetForSoftwareSelections.CPU; return; }
            if (c is ProtectionLevelChanged) { ((ProtectionLevelChanged)c).CurrentSelection = ProtectionLevelChangedSelections.NoChange; return; }
            if (c is DifferentTargetConfiguration && GetBool("target_hardware_confirmed")) { ((DifferentTargetConfiguration)c).CurrentSelection = DifferentTargetConfigurationSelections.AcceptAll; return; }
            if (c is DataBlockReinitilization && GetBool("memory_reinitialization_confirmed")) { ((DataBlockReinitilization)c).CurrentSelection = DataBlockReinitializationSelections.StopPlcAndReInitialize; return; }
            if (c is InitializeMemory && GetBool("memory_reinitialization_confirmed")) { ((InitializeMemory)c).CurrentSelection = InitializeMemorySelections.AcceptAll; return; }
            if (c is ModuleWriteAccessPassword && !string.IsNullOrEmpty(Password)) { ((ModuleWriteAccessPassword)c).SetPassword(Secure(Password)); return; }
            // Target mismatch, protection changes, resets, active tests and all unknown prompts abort.
            throw new NotSupportedException("AquaFlow refused Siemens download prompt: " + c.GetType().Name + " - " + c.Message);
        }

        private static void PostDownload(DownloadConfiguration c)
        {
            if (c is StartModules) { ((StartModules)c).CurrentSelection = StartModulesSelections.NoAction; return; }
            throw new NotSupportedException("AquaFlow refused Siemens post-download prompt: " + c.GetType().Name + " - " + c.Message);
        }

        private static SecureString Secure(string text)
        {
            var secure = new SecureString(); foreach (char c in text) secure.AppendChar(c); secure.MakeReadOnly(); return secure;
        }

        private static PlcSoftware FindPlcSoftware(Device device)
        {
            foreach (DeviceItem item in Walk(device.DeviceItems))
            {
                SoftwareContainer container = item.GetService<SoftwareContainer>();
                PlcSoftware plc = container == null ? null : container.Software as PlcSoftware;
                if (plc != null) return plc;
            }
            return null;
        }

        private static DeviceItem FindDownloadTarget(Device device)
        {
            return Walk(device.DeviceItems).FirstOrDefault(i => i.GetService<DownloadProvider>() != null);
        }

        private static IEnumerable<DeviceItem> Walk(DeviceItemComposition items)
        {
            foreach (DeviceItem item in items) { yield return item; foreach (DeviceItem child in Walk(item.DeviceItems)) yield return child; }
        }

        private static void CollectCompiler(CompilerResultMessageComposition messages, List<object> output)
        {
            foreach (CompilerResultMessage message in messages)
            {
                output.Add(new Dictionary<string, object> { { "severity", message.State.ToString() }, { "path", message.Path }, { "message", message.Description } });
                CollectCompiler(message.Messages, output);
            }
        }

        private static void RefuseCompilerErrors(CompilerResult result)
        {
            if (result.ErrorCount > 0 || result.State.ToString().IndexOf("Error", StringComparison.OrdinalIgnoreCase) >= 0)
                throw new InvalidOperationException("Siemens compilation failed with " + result.ErrorCount + " error(s); download remains blocked");
        }

        private static Dictionary<string, object> GenerateCyclicInterruptOb(PlcSoftware plc, string sources)
        {
            const string sourceName = "AquaFlowCycle.scl";
            var sourceFile = new FileInfo(Path.Combine(sources, sourceName));
            if (!sourceFile.Exists) throw new FileNotFoundException("Generated AquaFlow cyclic OB source is missing", sourceFile.FullName);
            PlcExternalSource oldSource = plc.ExternalSourceGroup.ExternalSources.Find(sourceName);
            if (oldSource != null) oldSource.Delete();
            PlcExternalSource source = plc.ExternalSourceGroup.ExternalSources.CreateFromFile(sourceName, sourceFile);
            source.GenerateBlocksFromSource();

            PlcBlock generated = plc.BlockGroup.Blocks.Find("AquaFlowCycle");
            if (generated == null) throw new InvalidOperationException("TIA did not generate AquaFlowCycle from the reviewed SCL source");
            string xmlPath = Path.Combine(Path.GetTempPath(), "aquaflow-cycle-native-" + Guid.NewGuid().ToString("N") + ".xml");
            try
            {
                // Export first so namespaces/schema/version come from the installed TIA release.
                generated.Export(new FileInfo(xmlPath), ExportOptions.WithDefaults);
                generated.Delete();
                XDocument document = XDocument.Load(xmlPath, LoadOptions.PreserveWhitespace);
                XElement ob = document.Descendants().FirstOrDefault(element => element.Name.LocalName == "SW.Blocks.OB");
                XElement attributes = ob == null ? null : ob.Elements().FirstOrDefault(element => element.Name.LocalName == "AttributeList");
                if (attributes == null) throw new InvalidOperationException("TIA OB export did not contain the expected SimaticML AttributeList");
                XElement number = attributes.Elements().FirstOrDefault(element => element.Name.LocalName == "Number");
                XElement secondary = attributes.Elements().FirstOrDefault(element => element.Name.LocalName == "SecondaryType");
                XElement automatic = attributes.Elements().FirstOrDefault(element => element.Name.LocalName == "AutoNumber");
                if (number == null || secondary == null)
                    throw new InvalidOperationException("TIA OB export does not expose Number and SecondaryType for supported import");
                if (automatic != null) automatic.Value = "false";
                number.Value = "200";
                secondary.Value = "CyclicInterrupt";
                // Event-specific values exported from the temporary program-cycle OB are
                // intentionally omitted. Siemens assigns the selected CPU's defaults for the
                // new cyclic-interrupt event; readback below requires 100 ms and phase zero.
                var eventAttributes = new HashSet<string>(StringComparer.Ordinal) {
                    "ApplicationCycle", "AutomaticMinimum", "ConstantName", "CycleTimeDistributedIO",
                    "CyclicApplicationCycleTime", "CyclicTime", "DataExchangeMode", "DelayTime",
                    "DistributedIOName", "DistributedIONumber", "EnableTimeError", "EventClass",
                    "EventsToBeQueued", "EventThresholdForTimeError", "Execution", "Factor",
                    "PhaseOffset", "PriorityNumber", "ProcessImagePartNumber", "ReportEvents",
                    "StartDate", "SynchronousApplicationCycleTime", "TimeMode", "TimeOfDay",
                    "TransformationDBNumber"
                };
                foreach (XElement element in attributes.Elements().Where(element => eventAttributes.Contains(element.Name.LocalName)).ToList())
                    element.Remove();
                document.Save(xmlPath, SaveOptions.DisableFormatting);
                IList<PlcBlock> imported = plc.BlockGroup.Blocks.Import(new FileInfo(xmlPath), ImportOptions.Override);
                if (imported == null || imported.Count != 1 || plc.BlockGroup.Blocks.Find("AquaFlowCycle") == null)
                    throw new InvalidOperationException("TIA did not import the CPU-specific AquaFlowCycle cyclic interrupt OB");
                // Read back the actual CPU/TIA interpretation. Any unsupported event name,
                // OB-number rule, cycle default or call representation fails project generation.
                return VerifyProgram(plc);
            }
            finally
            {
                if (File.Exists(xmlPath)) File.Delete(xmlPath);
            }
        }

        private static Dictionary<string, object> VerifyProgram(PlcSoftware plc)
        {
            VerifyIoBlock(plc);
            PlcBlock control = plc.BlockGroup.Blocks.Find("AquaFlowSiteControl");
            PlcBlock instance = plc.BlockGroup.Blocks.Find("AquaFlowSiteControlInstance");
            if (control == null || instance == null)
                throw new InvalidOperationException("AquaFlow control FB or its instance DB is missing");

            PlcBlock cycle = plc.BlockGroup.Blocks.Find("AquaFlowCycle");
            if (cycle == null)
                throw new InvalidOperationException("Missing automatically generated AquaFlowCycle; regenerate the TIA project with a matching supported Siemens PublicAPI");

            int number = Convert.ToInt32(cycle.GetAttribute("Number"));
            string secondary = Convert.ToString(cycle.GetAttribute("SecondaryType"));
            int cyclicTime;
            int phase;
            try
            {
                cyclicTime = Convert.ToInt32(cycle.GetAttribute("CyclicTime"));
                phase = Convert.ToInt32(cycle.GetAttribute("PhaseOffset"));
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException("AquaFlowCycle is not a Siemens cyclic interrupt OB exposing CyclicTime and PhaseOffset", ex);
            }
            if (number < 200 || secondary.IndexOf("Cyclic", StringComparison.OrdinalIgnoreCase) < 0 ||
                secondary.IndexOf("Interrupt", StringComparison.OrdinalIgnoreCase) < 0)
                throw new InvalidOperationException("AquaFlowCycle must be an S7-1200 cyclic interrupt OB with number 200 or higher; Siemens reports number " + number + " and type '" + secondary + "'");
            if (cyclicTime != 100000 || phase != 0)
                throw new InvalidOperationException("AquaFlowCycle must use 100000 us (100 ms) with phase 0; Siemens reports " + cyclicTime + " us and phase " + phase);

            string exported = Path.Combine(Path.GetTempPath(), "aquaflow-cycle-" + Guid.NewGuid().ToString("N") + ".xml");
            try
            {
                cycle.Export(new FileInfo(exported), ExportOptions.WithDefaults);
                string xml = File.ReadAllText(exported);
                foreach (string token in new[] { "AquaFlowSiteControlInstance", "EstopOK", "LevelOK", "ThermalOK", "DriveOK", "PressureOK" })
                    if (xml.IndexOf(token, StringComparison.Ordinal) < 0)
                        throw new InvalidOperationException("AquaFlowCycle does not contain the reviewed generated call; missing " + token + ". Regenerate the project and do not download this program");
            }
            finally
            {
                if (File.Exists(exported)) File.Delete(exported);
            }
            return new Dictionary<string, object> {
                { "io_db_number", GetInt("db_number") }, { "cyclic_ob", "AquaFlowCycle" },
                { "ob_number", number }, { "secondary_type", secondary },
                { "cycle_us", cyclicTime }, { "phase_us", phase }, { "call_verified", true }
            };
        }

        private static void VerifyIoBlock(PlcSoftware plc)
        {
            PlcBlock io = plc.BlockGroup.Blocks.Find("AquaFlowSiteIO");
            if (io == null) throw new InvalidOperationException("AquaFlowSiteIO DB is missing");
            int actual = Convert.ToInt32(io.GetAttribute("Number"));
            int expected = GetInt("db_number");
            if (actual != expected)
                throw new InvalidOperationException("AquaFlowSiteIO must be DB" + expected + "; Siemens reports DB" + actual);
        }

        private static void VerifyCpu(Device device)
        {
            string expected = Get("cpu_type_identifier");
            DeviceItem cpu = Walk(device.DeviceItems).FirstOrDefault(item => item.Name == Get("cpu_name"));
            if (cpu == null) throw new InvalidOperationException("Configured CPU item is absent from the TIA device");
            string actual = Convert.ToString(((IEngineeringObject)cpu).GetAttribute("TypeIdentifier"));
            if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("TIA project CPU TypeIdentifier '" + actual + "' does not match selected '" + expected + "'");
        }

        private static int EngineeringApiMajor()
        {
            var match = Regex.Match(typeof(TiaPortal).Assembly.Location, @"Portal V(?<v>\d+)", RegexOptions.IgnoreCase);
            if (match.Success) return Convert.ToInt32(match.Groups["v"].Value);
            int fileMajor = FileVersionInfo.GetVersionInfo(typeof(TiaPortal).Assembly.Location).FileMajorPart;
            if (fileMajor > 0) return fileMajor;
            throw new InvalidOperationException("Cannot determine Siemens.Engineering PublicAPI major version");
        }

        private static void AssertTiaVersion()
        {
            int selected = GetInt("tia_version"), actual = EngineeringApiMajor();
            if (selected != actual)
                throw new InvalidOperationException("Selected TIA Portal V" + selected + " does not match this bridge's Siemens PublicAPI V" + actual + "; rebuild the bridge against the selected installed release");
        }

        private sealed class Module
        {
            public string Name, TypeIdentifier; public int Position;
        }

        private static IEnumerable<Module> Modules()
        {
            object raw; if (!Request.TryGetValue("modules", out raw)) yield break;
            foreach (Dictionary<string, object> item in (object[])raw)
                yield return new Module { Name = Convert.ToString(item["name"]), TypeIdentifier = Convert.ToString(item["type_identifier"]), Position = Convert.ToInt32(item["position"]) };
        }

        private static string Get(string key, string fallback = null)
        {
            object value; if (!Request.TryGetValue(key, out value)) { if (fallback != null) return fallback; throw new ArgumentException("Missing " + key); }
            return Convert.ToString(value);
        }
        private static int GetInt(string key) { return Convert.ToInt32(Get(key)); }
        private static bool GetBool(string key) { object value; return Request.TryGetValue(key, out value) && Convert.ToBoolean(value); }
        private static string Arg(string[] args, string name) { int i = Array.IndexOf(args, name); if (i < 0 || i + 1 >= args.Length) throw new ArgumentException("Missing " + name); return args[i + 1]; }
    }
}
