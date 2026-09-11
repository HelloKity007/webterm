package handler

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestParseTmuxControlOutputDecodesPaneAndEscapes(t *testing.T) {
	event, ok := parseTmuxControlLine(`%output %7 \033[31mhello\\world\015\012`)
	if !ok {
		t.Fatal("control output was rejected")
	}
	if event.Name != "output" || event.Pane != "%7" {
		t.Fatalf("event = %#v", event)
	}
	want := []byte("\x1b[31mhello\\world\r\n")
	if !bytes.Equal(event.Data, want) {
		t.Fatalf("data = %q, want %q", event.Data, want)
	}
}

func TestTmuxControlPaneTrackerLearnsServerAssignedPane(t *testing.T) {
	tracker := &tmuxControlPaneTracker{}
	tracker.observe(tmuxControlEvent{Name: "session-changed", Pane: "%9"})
	if tracker.target() != "" {
		t.Fatal("non-output event selected a pane")
	}
	tracker.observe(tmuxControlEvent{Name: "output", Pane: "%7"})
	tracker.observe(tmuxControlEvent{Name: "output", Pane: "%8"})
	if tracker.target() != "%7" {
		t.Fatalf("target = %q, want first output pane", tracker.target())
	}
}

func TestTmuxControlInputWaitsForPaneIdentity(t *testing.T) {
	var out strings.Builder
	tracker := &tmuxControlPaneTracker{}
	input := &tmuxControlInput{tracker: tracker, writer: &out}
	if err := input.write("echo no pane"); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("err = %v, want ErrShortWrite", err)
	}
	tracker.observe(tmuxControlEvent{Name: "output", Pane: "%3"})
	if err := input.write("echo ok"); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out.String(), "send-keys -t %3 -l -- '") {
		t.Fatalf("encoded input = %q", out.String())
	}
}

func TestTmuxControlTerminalSessionEncodesResizeAsControlCommand(t *testing.T) {
	var out strings.Builder
	session := &tmuxControlTerminalSession{writer: &out}
	if err := session.WindowChange(44, 92); err != nil {
		t.Fatal(err)
	}
	if out.String() != "refresh-client -C 92x44\n" {
		t.Fatalf("resize command = %q", out.String())
	}
}

func TestEncodeTmuxControlSendKeysQuotesArbitraryInput(t *testing.T) {
	got := encodeTmuxControlSendKeys("%7", "echo '你好'\\\n")
	if !strings.HasPrefix(got, "send-keys -t %7 -l -- '") || !strings.HasSuffix(got, "'\n") || !strings.Contains(got, "\\''") {
		t.Fatalf("command = %q, want a quoted control-mode send-keys command", got)
	}
}

func TestEncodeTmuxControlSendKeysRejectsEmptyValues(t *testing.T) {
	if got := encodeTmuxControlSendKeys("", "x"); got != "" {
		t.Fatalf("empty pane encoded as %q", got)
	}
	if got := encodeTmuxControlSendKeys("%1", ""); got != "" {
		t.Fatalf("empty input encoded as %q", got)
	}
}

func TestPumpTmuxControlOutputForwardsOnlySelectedPane(t *testing.T) {
	stream := "%begin 1 0\n%output %1 hello\\012\n%output %2 ignored\\012\n%end 1 0\n"
	var got []byte
	if err := pumpTmuxControlOutput(strings.NewReader(stream), "%1", func(data []byte) error {
		got = append(got, data...)
		return nil
	}, nil); err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello\n" {
		t.Fatalf("forwarded = %q, want hello newline", got)
	}
}

func TestParseTmuxControlNonOutputEventPreservesFrame(t *testing.T) {
	event, ok := parseTmuxControlLine("%session-changed $0 test")
	if !ok || event.Name != "session-changed" || event.Raw != "%session-changed $0 test" {
		t.Fatalf("event = %#v ok=%v", event, ok)
	}
}

func TestParseTmuxControlRejectsMalformedOutput(t *testing.T) {
	for _, line := range []string{"%output", `%output %1 \12`, `%output %1 \999`} {
		if _, ok := parseTmuxControlLine(line); ok {
			t.Fatalf("malformed line accepted: %q", line)
		}
	}
}
