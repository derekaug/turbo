import { exec } from "child_process";
import path from "path";
import { getTurboRoot } from "turbo-utils";
import { getComparison } from "./getComparison";
import { getWorkspace } from "./getWorkspace";
import { info, error } from "./logger";
import { TurboIgnoreArgs } from "./types";

function ignoreBuild() {
  info(`ignoring the change`);
  return process.exit(0);
}

function continueBuild() {
  info(`proceeding with deployment`);
  return process.exit(1);
}

export default function turboIgnore({ args }: { args: TurboIgnoreArgs }) {
  info(
    "Using Turborepo to determine if this project is affected by the commit...\n"
  );

  // set default directory
  args.directory = args.directory
    ? path.resolve(args.directory)
    : process.cwd();

  // check for TURBO_FORCE and bail early if it's set
  if (process.env.TURBO_FORCE === "true") {
    info("`TURBO_FORCE` detected");
    return continueBuild();
  }

  // find the monorepo root
  const root = getTurboRoot(args.directory);
  if (!root) {
    error("monorepo root not found. turbo-ignore inferencing failed");
    return continueBuild();
  }

  // Find the workspace from the command-line args, or the package.json at the current directory
  const workspace = getWorkspace(args);
  if (!workspace) {
    return continueBuild();
  }

  // Get the start of the comparison (previous deployment when available, or previous commit by default)
  const comparison = getComparison({ workspace, fallback: args.fallback });
  if (!comparison) {
    // This is either the first deploy of the project, or the first deploy for the branch, either way - build it.
    return continueBuild();
  }

  // Build, and execute the command
  const command = `npx turbo run build --filter=${workspace}...[${comparison.ref}] --dry=json`;
  info(`analyzing results of \`${command}\``);
  exec(
    command,
    {
      cwd: root,
    },
    (err, stdout) => {
      if (err) {
        error(`exec error: ${err}`);
        return continueBuild();
      }

      try {
        const parsed = JSON.parse(stdout);
        if (parsed == null) {
          error(`failed to parse JSON output from \`${command}\`.`);
          return continueBuild();
        }
        const { packages } = parsed;
        if (packages && packages.length > 0) {
          if (packages.length === 1) {
            info(`this commit affects "${workspace}"`);
          } else {
            // subtract 1 because the first package is the workspace itself
            info(
              `this commit affects "${workspace}" and ${packages.length - 1} ${
                packages.length - 1 === 1 ? "dependency" : "dependencies"
              } (${packages.slice(1).join(", ")})`
            );
          }

          return continueBuild();
        } else {
          info(`this project and its dependencies are not affected`);
          return ignoreBuild();
        }
      } catch (e) {
        error(`failed to parse JSON output from \`${command}\`.`);
        error(e);
        return continueBuild();
      }
    }
  );
}
