package sftpmgr

import "testing"

func TestPathWithinUsesPathBoundaries(t *testing.T) {
	tests := []struct {
		parent, candidate string
		want              bool
	}{
		{"/data/source", "/data/source", true},
		{"/data/source", "/data/source/child", true},
		{"/data/source", "/data/source-other", false},
		{"/data/source", "/data/elsewhere", false},
	}
	for _, test := range tests {
		if got := pathWithin(test.parent, test.candidate); got != test.want {
			t.Errorf("pathWithin(%q, %q)=%v want %v", test.parent, test.candidate, got, test.want)
		}
	}
}
