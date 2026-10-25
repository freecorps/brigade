import { type ConfigPlugin, withMod } from "expo/config-plugins";

// expo-splash-screen (SDK 58) writes the light and dark ground into the `SplashScreenBackground`
// colour set, but only points the iOS launch screen at it when there is a splash image. With no image,
// SplashScreen.storyboard keeps the template's `systemBackgroundColor`: pure white or black, not
// packages/ui's ground. This points the launch screen's view at the colour set, as expo-splash-screen
// does when an image is present. Drop it once there is a splash image. See
// docs/spikes/s4-expo-workspace.md, "iOS".

/** The xml2js shape of an Interface Builder element: attributes under `$`, children in arrays. */
export interface XmlElement {
  $?: Record<string, string>;
  [child: string]: XmlElement[] | Record<string, string> | undefined;
}

export interface Storyboard {
  document: XmlElement;
}

const COLOR_NAME = "SplashScreenBackground";

const children = (element: XmlElement | undefined, name: string): XmlElement[] => {
  const value = element?.[name];
  return Array.isArray(value) ? value : [];
};

/**
 * sRGB components between 0 and 1 from `#rrggbb`, written the way expo-splash-screen writes them
 * (15 significant digits, blue first), so both produce the same XML.
 */
function components(hex: string): Record<"blue" | "green" | "red", string> {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Expected a #rrggbb colour, got ${hex}`);
  const channel = (value: string | undefined) =>
    (Number.parseInt(value ?? "0", 16) / 255).toPrecision(15);
  return { blue: channel(match[3]), green: channel(match[2]), red: channel(match[1]) };
}

/**
 * Makes the launch screen's root view use the `SplashScreenBackground` colour set (light and dark).
 * `fallback` is the colour Interface Builder shows when the set is missing: the light ground.
 */
export function applySplashGround(storyboard: Storyboard, fallback: string): Storyboard {
  const { document } = storyboard;
  const view = children(
    children(children(children(document, "scenes")[0], "scene")[0], "objects")[0],
    "viewController",
  )[0];
  const root = children(view, "view")[0];
  if (!root) throw new Error("SplashScreen.storyboard has no launch view");
  root.color = [
    ...children(root, "color").filter((color) => color.$?.key !== "backgroundColor"),
    { $: { key: "backgroundColor", name: COLOR_NAME } },
  ];

  // Declare the named colour, creating <resources> if the storyboard has none.
  if (children(document, "resources").length === 0) document.resources = [{}];
  const resources = children(document, "resources")[0] as XmlElement;
  // The template's systemBackgroundColor is no longer used; other system colours stay.
  const systemColors = children(resources, "systemColor").filter(
    (color) => color.$?.name !== "systemBackgroundColor",
  );
  if (systemColors.length > 0) resources.systemColor = systemColors;
  else delete resources.systemColor;
  resources.namedColor = [
    ...children(resources, "namedColor").filter((color) => color.$?.name !== COLOR_NAME),
    {
      $: { name: COLOR_NAME },
      color: [
        {
          $: {
            alpha: "1.000",
            ...components(fallback),
            customColorSpace: "sRGB",
            colorSpace: "custom",
          },
        },
      ],
    },
  ];
  return storyboard;
}

/**
 * Config plugin on expo-splash-screen's `splashScreenStoryboard` mod. Order does not matter: without
 * an image, expo-splash-screen leaves the view's colour and the colour resources alone.
 */
export const withSplashGround: ConfigPlugin<{ fallback: string }> = (config, { fallback }) =>
  withMod<Storyboard>(config, {
    platform: "ios",
    mod: "splashScreenStoryboard",
    action: (modConfig) => {
      modConfig.modResults = applySplashGround(modConfig.modResults, fallback);
      return modConfig;
    },
  });
