// Package migrations embeds the SQL schema files so the server ships as a single
// binary and can bring a fresh database up to date on boot.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
