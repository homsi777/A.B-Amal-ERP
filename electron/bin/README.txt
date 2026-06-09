CLOTEX packaged SSH tunnel requires PuTTY plink.exe in this folder.

Before running npm run electron:build or electron:pack:
  1. Download PuTTY from https://www.chiark.greenend.org.uk/~sgtatham/putty/
  2. Copy plink.exe into this folder as: electron/bin/plink.exe

The installer copies it to resources/bin/plink.exe (see package.json extraResources).
plink.exe is gitignored; do not commit the binary to Git.
