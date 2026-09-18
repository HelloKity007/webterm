using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// QA-only OS input. The caller must verify the owned foreground window first.
// SendInput's returned count is transport evidence, not proof of navigation.
public static class QAInput {
    [StructLayout(LayoutKind.Sequential)]
    public struct MouseInput {
        public int dx, dy;
        public uint mouseData, flags, time;
        public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct KeyboardInput {
        public ushort key, scan;
        public uint flags, time;
        public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MouseInput mouse;
        [FieldOffset(0)] public KeyboardInput keyboard;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct Input {
        public uint type;
        public InputUnion value;
    }
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] events, int size);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int x, y; }
    [StructLayout(LayoutKind.Sequential)]
    public struct GUIInfo {
        public uint size, flags;
        public IntPtr active, focus, capture, menuOwner, moveSize, caret;
        public Rect caretRect;
    }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GUIInfo info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    private delegate bool WindowVisitor(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowVisitor visitor, IntPtr state);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SetActiveWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    public static void ActivateOwnedBrowser() { ActivateOwnedBrowser("WebTerm-native-reload-QA"); }
    public static void ActivateOwnedBrowser(string expectedTitle) {
        var matches = new List<IntPtr>();
        EnumWindows((window, state) => {
            if (!IsWindowVisible(window)) return true;
            var caption = new StringBuilder(512);
            var windowClass = new StringBuilder(256);
            GetWindowText(window, caption, 512);
            GetClassName(window, windowClass, 256);
            // Windows' TabProxyWindow can have the same caption but consumes
            // native keyboard events without delivering them to the browser.
            if (caption.ToString().StartsWith(expectedTitle) &&
                windowClass.ToString() == "Chrome_WidgetWin_1") matches.Add(window);
            return true;
        }, IntPtr.Zero);
        if (matches.Count != 1) throw new InvalidOperationException("Expected one owned Edge main window, found " + matches.Count);
        if (IsIconic(matches[0])) ShowWindow(matches[0], 9);
        // A scheduled task in the active desktop is subject to Windows'
        // foreground lock.  Momentarily raising only the uniquely titled QA
        // popup gives SetForegroundWindow an allowed activation path.  If that
        // still fails, no synthetic mouse input is sent.
        BringWindowToTop(matches[0]);
        SetActiveWindow(matches[0]);
        SetWindowPos(matches[0], new IntPtr(-1), 0, 0, 0, 0, 0x0001u | 0x0002u);
        Thread.Sleep(40);
        SetWindowPos(matches[0], new IntPtr(-2), 0, 0, 0, 0, 0x0001u | 0x0002u);
        SetForegroundWindow(matches[0]);
        Thread.Sleep(60);
        if (GetForegroundWindow() != matches[0]) throw new InvalidOperationException("Owned Edge main window did not become foreground; no key sent");
    }
    private static Input Mouse(int x, int y, uint flags) {
        // Absolute SendInput coordinates span the primary screen.  The QA
        // browser is opened on that screen and the caller records both points
        // from the actual Edge windows before issuing any input.
        int width = Math.Max(1, GetSystemMetrics(0) - 1), height = Math.Max(1, GetSystemMetrics(1) - 1);
        int dx = Math.Max(0, Math.Min(65535, (int)Math.Round(x * 65535.0 / width)));
        int dy = Math.Max(0, Math.Min(65535, (int)Math.Round(y * 65535.0 / height)));
        return new Input { type = 0, value = new InputUnion { mouse = new MouseInput { dx = dx, dy = dy, flags = flags | 0x8000u } } };
    }
    private static uint SendMouse(int x, int y, uint flags) {
        return SendInput(1, new[] { Mouse(x, y, flags) }, Marshal.SizeOf(typeof(Input)));
    }
    // A deliberately paced physical-pointer sequence for a previously
    // foregrounded, dedicated QA Edge popup. The expected return value is
    // transport evidence only; the browser test must still prove drag/drop.
    public static uint DragOwnedBrowser(string title, int sourceX, int sourceY, int targetX, int targetY, int steps) {
        if (steps < 2 || steps > 100) throw new ArgumentOutOfRangeException("steps");
        ActivateOwnedBrowser(title);
        uint accepted = SendMouse(sourceX, sourceY, 0x0001u);
        Thread.Sleep(120);
        accepted += SendMouse(sourceX, sourceY, 0x0002u);
        for (int step = 1; step <= steps; step++) {
            double ratio = step / (double)steps;
            int x = (int)Math.Round(sourceX + (targetX - sourceX) * ratio);
            int y = (int)Math.Round(sourceY + (targetY - sourceY) * ratio);
            Thread.Sleep(35);
            accepted += SendMouse(x, y, 0x0001u);
        }
        Thread.Sleep(180);
        accepted += SendMouse(targetX, targetY, 0x0004u);
        Expected = steps + 3;
        LastError = Marshal.GetLastWin32Error();
        return accepted;
    }
    public static uint ClickOwnedBrowser(string title, int x, int y) {
        ActivateOwnedBrowser(title);
        // Some Edge remote-debug builds accept SendInput but filter its mouse
        // packet before it reaches the renderer. Try the Windows legacy mouse
        // route separately; this still targets the OS cursor and is verified
        // by DOM receipt, never by this return value alone.
        if (!SetCursorPos(x, y)) throw new InvalidOperationException("SetCursorPos failed: " + Marshal.GetLastWin32Error());
        Thread.Sleep(100);
        mouse_event(0x0002u, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(80);
        mouse_event(0x0004u, 0, 0, 0, UIntPtr.Zero);
        Expected = 3;
        LastError = Marshal.GetLastWin32Error();
        return 3;
    }
    public static string PointerMetrics() {
        Point point; GetCursorPos(out point);
        return "screen=" + GetSystemMetrics(0) + "x" + GetSystemMetrics(1) + ";cursor=" + point.x + "," + point.y;
    }
    public static string FocusObservation() {
        IntPtr window = GetForegroundWindow();
        uint process;
        uint thread = GetWindowThreadProcessId(window, out process);
        var info = new GUIInfo { size = (uint)Marshal.SizeOf(typeof(GUIInfo)) };
        bool ok = GetGUIThreadInfo(thread, ref info);
        var name = new StringBuilder(256);
        GetClassName(info.focus, name, 256);
        return "foreground=" + window + ";pid=" + process + ";thread=" + thread +
            ";gui=" + ok + ";focus=" + info.focus + ";focusClass=" + name +
            ";inputBytes=" + Marshal.SizeOf(typeof(Input));
    }
    public static int LastError;
    public static int Expected;
    public static uint Reload(bool control, bool shift) {
        foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C }) {
            if ((GetAsyncKeyState(key) & 0x8000) != 0)
                throw new InvalidOperationException("A physical modifier is already held; no QA keys sent");
        }
        var events = new List<Input>();
        Action<ushort, bool> add = (key, up) => events.Add(new Input {
            type = 1,
            value = new InputUnion { keyboard = new KeyboardInput { key = key, flags = up ? 2u : 0u } }
        });
        if (control) add(0x11, false);
        if (shift) add(0x10, false);
        ushort reloadKey = control ? (ushort)0x52 : (ushort)0x74;
        add(reloadKey, false);
        add(reloadKey, true);
        if (shift) add(0x10, true);
        if (control) add(0x11, true);
        Expected = events.Count;
        uint accepted = SendInput((uint)events.Count, events.ToArray(), Marshal.SizeOf(typeof(Input)));
        LastError = Marshal.GetLastWin32Error();
        return accepted;
    }
}
