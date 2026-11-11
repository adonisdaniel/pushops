// Package assets embeds the static assets shipped with the server: the vanilla-JS
// single page application and the on-device pose model files.
//
// The embed patterns live at the module root because go:embed resolves paths
// relative to the package directory and cannot reach parent directories.
package pushops

import "embed"

//go:embed all:web all:static
var FS embed.FS
