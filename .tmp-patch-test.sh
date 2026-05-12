#!/bin/sh
set -e
REPO="/Users/kara/Desktop/dev/ios-agent-pipeline/.tmp-patch-repo"
rm -rf "$REPO"
mkdir "$REPO"
cd "$REPO"
git init -q
git config user.email t@t
git config user.name t
printf 'a\nb\nc\n' > t.txt
git add t.txt && git commit -qm init
BAD='diff --git a/t.txt b/t.txt
--- a/t.txt
+++ b/t.txt
@@ -1,3 +1,4 @@
 a
 b

 c
'
printf '%s' "$BAD" | git apply --whitespace=nowarn - 2>&1 || echo "BAD_APPLY_EXIT_$?"
FIXED=$(node -e "
const lines = \`$BAD\`.replace(/\\r\\n/g,'\\n').split('\\n');
let inHunk=false,out=[];
for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(/^diff --git /.test(line)){inHunk=false;out.push(line);continue}
  if(/^@@/.test(line)){inHunk=true;out.push(line);continue}
  if(inHunk && line===''){
    const next=lines[i+1]||'';
    if(/^diff --git /.test(next)){inHunk=false;out.push('');continue}
    out.push(' ');continue
  }
  if(inHunk && line.length && !/^[ +\\-\\\\]/.test(line)){inHunk=false}
  out.push(line);
}
process.stdout.write(out.join('\\n')+(out[out.length-1]===''?'':'\\n'));
")
printf '%s' "$FIXED" | git apply --whitespace=nowarn --recount --inaccurate-eof - 2>&1 && echo OK
