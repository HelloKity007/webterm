package main

import "testing"

func TestResolveTmuxOptions(t *testing.T) {
	for _, tc := range []struct {
		name, env, binary, socket, testBinary, testSocket string
		testExplicit, fail                                bool
		wantBinary, wantSocket                            string
	}{
		{name: "legacy production", env: "production"},
		{name: "legacy test", env: "release-test", wantSocket: "webterm-release-test"},
		{name: "production isolated", env: "production", binary: "/opt/tmux/bin/tmux", socket: "webterm-production-fixed", wantBinary: "/opt/tmux/bin/tmux", wantSocket: "webterm-production-fixed"},
		{name: "test isolated", env: "release-test", testBinary: "/opt/tmux", testSocket: "webterm-release-test-fixed", wantBinary: "/opt/tmux", wantSocket: "webterm-release-test-fixed"},
		{name: "missing socket", env: "production", binary: "/opt/tmux", fail: true},
		{name: "missing binary", env: "production", socket: "webterm-production-fixed", fail: true},
		{name: "cross socket", env: "production", binary: "/opt/tmux", socket: "webterm-release-test-fixed", fail: true},
		{name: "relative", env: "production", binary: "opt/tmux", socket: "webterm-production-fixed", fail: true},
		{name: "unsafe", env: "production", binary: "/opt/tmux;id", socket: "webterm-production-fixed", fail: true},
		{name: "mixed explicit default", env: "production", binary: "/opt/tmux", socket: "webterm-production-fixed", testExplicit: true, fail: true},
		{name: "production test override", env: "production", testBinary: "/opt/tmux", fail: true},
		{name: "unknown env", env: "other", binary: "/opt/tmux", socket: "webterm-production-fixed", fail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.testSocket == "" {
				tc.testSocket = "webterm-release-test"
			}
			b, s, err := resolveTmuxOptions(tc.env, tc.binary, tc.socket, tc.testBinary, tc.testSocket, tc.testExplicit)
			if (err != nil) != tc.fail {
				t.Fatalf("error=%v, want failure=%v", err, tc.fail)
			}
			if !tc.fail && (b != tc.wantBinary || s != tc.wantSocket) {
				t.Fatalf("got %q %q", b, s)
			}
		})
	}
}
