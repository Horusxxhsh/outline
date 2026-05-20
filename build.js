/* oxlint-disable no-console */
/* oxlint-disable @typescript-oxlint/no-var-requires */
/* oxlint-disable no-undef */
const { exec } = require("child_process");
const { cpSync, existsSync, mkdirSync, readdirSync, rmSync } = require("fs");

const getDirectories = (source) =>
  readdirSync(source, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

/**
 * Executes a shell command and return it as a Promise.
 * @param cmd {string}
 * @return {Promise<string>}
 */
function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout ? stdout : stderr);
      }
    });
  });
}

async function build() {
  // Clean previous build
  console.log("Clean previous build…");

  rmSync("./build/server", { force: true, recursive: true });
  rmSync("./build/plugins", { force: true, recursive: true });

  const d = getDirectories("./plugins");

  // Compile server and shared
  console.log("Compiling…");
  await Promise.all([
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/server ./server"
    ),
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/shared ./shared"
    ),
  ]);

  for (const plugin of d) {
    const hasServer = existsSync(`./plugins/${plugin}/server`);

    if (hasServer) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/server" "./plugins/${plugin}/server"`
      );
    }

    const hasShared = existsSync(`./plugins/${plugin}/shared`);

    if (hasShared) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/shared" "./plugins/${plugin}/shared"`
      );
    }
  }

  // Copy static files
  console.log("Copying static files…");
  cpSync(
    "./server/collaboration/Procfile",
    "./build/server/collaboration/Procfile"
  );
  mkdirSync("./build/server/protos", { recursive: true });
  cpSync(
    "./server/protos/notification.proto",
    "./build/server/protos/notification.proto"
  );
  cpSync("./server/static/error.dev.html", "./build/server/error.dev.html");
  cpSync("./server/static/error.prod.html", "./build/server/error.prod.html");
  cpSync("package.json", "./build/package.json");

  for (const plugin of d) {
    if (!existsSync(`./plugins/${plugin}/plugin.json`)) {
      continue;
    }

    mkdirSync(`./build/plugins/${plugin}`, { recursive: true });
    cpSync(
      `./plugins/${plugin}/plugin.json`,
      `./build/plugins/${plugin}/plugin.json`
    );
  }

  console.log("Done!");
}

void build();
