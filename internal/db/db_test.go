package db

import "testing"

func TestSplitStatements(t *testing.T) {
	script := `
-- a comment with a ; semicolon
CREATE TABLE IF NOT EXISTS t (
  id INTEGER PRIMARY KEY,
  name TEXT DEFAULT 'a;b'
);
/* block ; comment */
INSERT INTO t (id, name) VALUES (1, 'x');
`
	got := SplitStatements(script)
	if len(got) != 2 {
		t.Fatalf("got %d statements, want 2:\n%#v", len(got), got)
	}
	if got[0][:13] != "CREATE TABLE " {
		t.Errorf("unexpected first statement: %q", got[0])
	}
	if got[1][:14] != "INSERT INTO t " {
		t.Errorf("unexpected second statement: %q", got[1])
	}
}

func TestSplitStatementsIgnoresTrailingSemicolons(t *testing.T) {
	if got := SplitStatements("SELECT 1;;;  \n"); len(got) != 1 {
		t.Fatalf("got %d statements, want 1", len(got))
	}
}

func TestVersionFromName(t *testing.T) {
	cases := map[string]int{
		"0001_init.sql":       1,
		"0002_more_stuff.sql": 2,
	}
	for name, want := range cases {
		if got := versionFromName(name); got != want {
			t.Errorf("versionFromName(%q) = %d, want %d", name, got, want)
		}
	}
}
