import { describe, expect, test } from "vite-plus/test";
import { applySplashGround, type Storyboard, type XmlElement } from "./splash-ground.ts";

// What expo-splash-screen 58 leaves in SplashScreen.storyboard without a splash image (xml2js shape,
// trimmed to the parts that matter).
const withoutImage = (): Storyboard => ({
  document: {
    $: { launchScreen: "YES" },
    scenes: [
      {
        scene: [
          {
            objects: [
              {
                viewController: [
                  {
                    view: [
                      {
                        $: { id: "EXPO-ContainerView" },
                        color: [
                          { $: { key: "backgroundColor", systemColor: "systemBackgroundColor" } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    resources: [
      {
        systemColor: [{ $: { name: "systemBackgroundColor" } }],
      },
    ],
  },
});

type Tree = { scenes: [{ scene: [{ objects: [{ viewController: [{ view: [XmlElement] }] }] }] }] };
const rootView = (storyboard: Storyboard) =>
  (storyboard.document as unknown as Tree).scenes[0].scene[0].objects[0].viewController[0].view[0];

describe("applySplashGround", () => {
  test("points the launch view at the SplashScreenBackground colour set", () => {
    const storyboard = applySplashGround(withoutImage(), "#f7f7f5");
    expect(rootView(storyboard).color).toEqual([
      { $: { key: "backgroundColor", name: "SplashScreenBackground" } },
    ]);
  });

  test("declares the named colour with the light ground as fallback, and drops the system colour", () => {
    const storyboard = applySplashGround(withoutImage(), "#ffffff");
    const resources = (storyboard.document.resources as Storyboard["document"][])[0];
    expect(resources?.systemColor).toBeUndefined();
    expect(resources?.namedColor).toEqual([
      {
        $: { name: "SplashScreenBackground" },
        color: [
          {
            $: {
              alpha: "1.000",
              red: "1",
              green: "1",
              blue: "1",
              customColorSpace: "sRGB",
              colorSpace: "custom",
            },
          },
        ],
      },
    ]);
  });

  test("is idempotent", () => {
    const once = applySplashGround(withoutImage(), "#121211");
    expect(applySplashGround(structuredClone(once), "#121211")).toEqual(once);
  });

  test("rejects a storyboard without a launch view", () => {
    expect(() => applySplashGround({ document: { scenes: [] } }, "#ffffff")).toThrow();
  });
});
