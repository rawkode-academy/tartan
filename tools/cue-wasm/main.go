// The repository-config evaluator, compiled with GOOS=js GOARCH=wasm and run
// in a Dynamic Worker (src/kernel/repoconfig/evaluators/wasm.ts). It does what
// `cue export -E --out json .:tartan` does, through the same upstream packages:
// the module loader selects package tartan from an overlay of the request's
// files, and errors print in the CLI's format, so tartan.cue-eval/1 sees the
// same bytes from either. The corpus test compares the two.
//
// One instance evaluates one request. The host sets __cueInput to
// {"files":{"<path>":"<text>"}}, __cueStart receives the linked CUE version and
// __cueDone receives
// {"rc":0|1,"cue":"<version>","out":"<json>","err":"<text>"}. A Go runtime
// fatal (out of memory at the module's memory cap) never reaches __cueDone: the
// process exits 2 and the host reads the fatal from stderr.
package main

import (
	"bytes"
	"encoding/json"
	"runtime/debug"
	"syscall/js"

	"cuelang.org/go/cue"
	"cuelang.org/go/cue/cuecontext"
	cueerrors "cuelang.org/go/cue/errors"
	"cuelang.org/go/cue/load"
)

// moduleRoot only exists in the overlay: the guest's filesystem is empty.
const moduleRoot = "/m"

// softMemoryLimit makes the collector work harder before the module's hard
// memory cap (scripts/build-cue-wasm.ts) turns allocation into a fatal.
const softMemoryLimit = 64 << 20

type request struct {
	Files map[string]string `json:"files"`
}

type result struct {
	RC  int    `json:"rc"`
	Cue string `json:"cue"`
	Out string `json:"out"`
	Err string `json:"err"`
}

// cueVersion reads the linked module's version, so a build from another
// release fails the classifier's version check instead of evaluating.
func cueVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, dep := range info.Deps {
		if dep.Path == "cuelang.org/go" {
			return dep.Version
		}
	}
	return ""
}

func evaluate(req request) (out string, errText string, rc int) {
	fail := func(err error) (string, string, int) {
		var text bytes.Buffer
		cueerrors.Print(&text, err, &cueerrors.Config{Cwd: moduleRoot})
		return "", text.String(), 1
	}
	overlay := make(map[string]load.Source, len(req.Files))
	for path, text := range req.Files {
		overlay[moduleRoot+"/"+path] = load.FromString(text)
	}
	instances := load.Instances([]string{".:tartan"}, &load.Config{
		Dir:        moduleRoot,
		ModuleRoot: moduleRoot,
		Overlay:    overlay,
		Env:        []string{"CUE_REGISTRY=none"},
	})
	if err := instances[0].Err; err != nil {
		return fail(err)
	}
	value := cuecontext.New().BuildInstance(instances[0])
	if err := value.Validate(cue.Concrete(true)); err != nil {
		return fail(err)
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "    ")
	if err := encoder.Encode(value); err != nil {
		if marshal, ok := err.(*json.MarshalerError); ok {
			err = marshal.Err
		}
		return fail(err)
	}
	return encoded.String(), "", 0
}

func main() {
	debug.SetMemoryLimit(softMemoryLimit)
	global := js.Global()
	global.Call("__cueStart", cueVersion())
	var req request
	if err := json.Unmarshal([]byte(global.Get("__cueInput").String()), &req); err != nil {
		panic(err)
	}
	out, errText, rc := evaluate(req)
	encoded, err := json.Marshal(result{RC: rc, Cue: cueVersion(), Out: out, Err: errText})
	if err != nil {
		panic(err)
	}
	global.Call("__cueDone", string(encoded))
}
