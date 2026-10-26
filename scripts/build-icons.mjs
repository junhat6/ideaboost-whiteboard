import icons from "@primer/octicons";
import { writeFile } from "node:fs/promises";
const names = [
  "sync",
  "screen-full",
  "moon",
  "question",
  "eye",
  "pencil",
  "code",
  "kebab-horizontal",
  "git-pull-request",
  "git-pull-request-draft",
  "git-pull-request-closed",
  "git-merge",
];
const selected = Object.fromEntries(
  names.map((name) => [
    name,
    icons[name].toSVG({
      width: 16,
      height: 16,
      "aria-hidden": "true",
      focusable: "false",
    }),
  ]),
);
await writeFile(
  "web/icons.js",
  "/*! @primer/octicons 19.42.0 | MIT | Copyright GitHub Inc. https://github.com/primer/octicons */\nwindow.BoardIcons=Object.freeze(" +
    JSON.stringify(selected) +
    ");\n",
);
