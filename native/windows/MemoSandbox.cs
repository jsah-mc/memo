using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

internal static class MemoSandbox
{
    const uint TOKEN_ALL_ACCESS = 0xF01FF, DISABLE_MAX_PRIVILEGE = 0x1;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x400, CREATE_NO_WINDOW = 0x08000000;
    const uint STARTF_USESTDHANDLES = 0x100;
    const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8, JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const int JobObjectExtendedLimitInformation = 9;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute; public uint dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMITS { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMITS { public BASIC_LIMITS BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool CreateRestrictedToken(IntPtr existing, uint flags, uint disableSidCount, IntPtr sidsToDisable, uint deletePrivilegeCount, IntPtr privilegesToDelete, uint restrictedSidCount, IntPtr restrictedSids, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUser(IntPtr token, string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd, ref STARTUPINFO startup, out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static string Quote(string value) { return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
    static void Check(bool ok, string action) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), action); }

    public static int Main(string[] args)
    {
        IntPtr primary = IntPtr.Zero, restricted = IntPtr.Zero, job = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        try {
            int separator = Array.IndexOf(args, "--");
            if (separator < 0 || separator == args.Length - 1) throw new ArgumentException("Usage: MemoSandbox --cwd <folder> -- <command>");
            string cwd = separator >= 2 && args[0] == "--cwd" && !String.IsNullOrWhiteSpace(args[1]) ? args[1] : Environment.CurrentDirectory;
            string shell = Environment.ExpandEnvironmentVariables(@"%SystemRoot%\System32\cmd.exe");
            string command = String.Join(" ", args, separator + 1, args.Length - separator - 1);
            var commandLine = new StringBuilder(Quote(shell) + " /d /s /c " + Quote(command));
            Check(OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, out primary), "OpenProcessToken");
            Check(CreateRestrictedToken(primary, DISABLE_MAX_PRIVILEGE, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out restricted), "CreateRestrictedToken");
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject");
            var limits = new EXTENDED_LIMITS();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            limits.BasicLimitInformation.ActiveProcessLimit = 32;
            limits.ProcessMemoryLimit = (UIntPtr)(1024UL * 1024UL * 1024UL);
            int size = Marshal.SizeOf(limits); IntPtr buffer = Marshal.AllocHGlobal(size);
            try { Marshal.StructureToPtr(limits, buffer, false); Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size), "SetInformationJobObject"); }
            finally { Marshal.FreeHGlobal(buffer); }
            var startup = new STARTUPINFO { cb = Marshal.SizeOf(typeof(STARTUPINFO)), dwFlags = STARTF_USESTDHANDLES, hStdInput = GetStdHandle(-10), hStdOutput = GetStdHandle(-11), hStdError = GetStdHandle(-12) };
            Check(CreateProcessAsUser(restricted, null, commandLine, IntPtr.Zero, IntPtr.Zero, true, CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW, IntPtr.Zero, cwd, ref startup, out process), "CreateProcessAsUser");
            Check(AssignProcessToJobObject(job, process.hProcess), "AssignProcessToJobObject");
            WaitForSingleObject(process.hProcess, 0xFFFFFFFF);
            uint exitCode; Check(GetExitCodeProcess(process.hProcess, out exitCode), "GetExitCodeProcess");
            return unchecked((int)exitCode);
        }
        catch (Exception error) { Console.Error.WriteLine("Memo sandbox: " + error.Message); return 125; }
        finally { if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread); if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess); if (job != IntPtr.Zero) CloseHandle(job); if (restricted != IntPtr.Zero) CloseHandle(restricted); if (primary != IntPtr.Zero) CloseHandle(primary); }
    }
}
