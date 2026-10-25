import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
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
              blue: "1.00000000000000",
              green: "1.00000000000000",
              red: "1.00000000000000",
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

  test("keeps other system colours and creates <resources> when missing", () => {
    const storyboard = withoutImage();
    const resources = (storyboard.document.resources as XmlElement[])[0] as XmlElement;
    resources.systemColor = [
      { $: { name: "systemBackgroundColor" } },
      { $: { name: "labelColor" } },
    ];
    applySplashGround(storyboard, "#ffffff");
    expect(resources.systemColor).toEqual([{ $: { name: "labelColor" } }]);

    const bare = withoutImage();
    delete bare.document.resources;
    applySplashGround(bare, "#ffffff");
    // `delete` narrowed the field to undefined; applySplashGround has filled it since.
    const created = bare.document.resources as unknown as XmlElement[];
    expect(created[0]?.namedColor).toHaveLength(1);
  });
});

// expo-splash-screen's storyboard helpers, from its compiled plugin. Its `exports` map only exposes
// `./plugin` (the plugin factory), so this loads plugin/build/InterfaceBuilder.js by path: an internal
// module of expo-splash-screen 58, not a stable API. If an SDK upgrade moves it, update the path.
interface InterfaceBuilder {
  toObjectAsync(contents: string): Promise<Storyboard>;
  toString(xml: Storyboard): string;
  removeImageFromSplashScreen(xml: Storyboard, options: { imageName: string }): Storyboard;
  applyImageToSplashScreenXML(
    xml: Storyboard,
    options: {
      imageName: string;
      contentMode: string;
      backgroundColor: string;
      enableFullScreenImage: boolean;
      imageWidth: number;
    },
  ): Storyboard;
}
// Resolved from the package's own package.json (which `exports` allows), wherever Bun installed it.
const INTERFACE_BUILDER = createRequire(import.meta.url)
  .resolve("expo-splash-screen/package.json")
  .replace(/package\.json$/, "plugin/build/InterfaceBuilder.js");
const loadInterfaceBuilder = async () =>
  (await import(pathToFileURL(INTERFACE_BUILDER).href)) as InterfaceBuilder;

// SplashScreen.storyboard from the SDK 58 bare template (expo/template.tgz, template 58.0.28), verbatim.
const BARE_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="24093.7" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="EXPO-VIEWCONTROLLER-1">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="24053.1"/>
        <capability name="Named colors" minToolsVersion="9.0"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="System colors in document resources" minToolsVersion="11.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <!--View Controller-->
        <scene sceneID="EXPO-SCENE-1">
            <objects>
                <viewController storyboardIdentifier="SplashScreenViewController" id="EXPO-VIEWCONTROLLER-1" sceneMemberID="viewController">
                    <view key="view" userInteractionEnabled="NO" contentMode="scaleToFill" insetsLayoutMarginsFromSafeArea="NO" id="EXPO-ContainerView" userLabel="ContainerView">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" flexibleMaxX="YES" flexibleMaxY="YES"/>
                        <subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" horizontalHuggingPriority="251" verticalHuggingPriority="251" image="SplashScreen" translatesAutoresizingMaskIntoConstraints="NO" id="EXPO-SplashScreen" userLabel="SplashScreen">
                                <rect key="frame" x="146.66666666666666" y="381" width="100" height="90.333333333333314"/>
                                <accessibility key="accessibilityConfiguration">
                                    <accessibilityTraits key="traits" image="YES" notEnabled="YES"/>
                                </accessibility>
                            </imageView>
                        </subviews>
                        <viewLayoutGuide key="safeArea" id="Rmq-lb-GrQ"/>
                        <constraints>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="centerY" secondItem="EXPO-ContainerView" secondAttribute="centerY" id="0VC-Wk-OaO"/>
                            <constraint firstItem="EXPO-SplashScreen" firstAttribute="centerX" secondItem="EXPO-ContainerView" secondAttribute="centerX" id="zR4-NK-mVN"/>
                        </constraints>
                        <color key="backgroundColor" systemColor="systemBackgroundColor"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="EXPO-PLACEHOLDER-1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="0.0" y="0.0"/>
        </scene>
    </scenes>
    <resources>
        <image name="SplashScreenLogo" width="100" height="90.333335876464844"/>
        <systemColor name="systemBackgroundColor">
            <color white="1" alpha="1" colorSpace="custom" customColorSpace="genericGamma22GrayColorSpace"/>
        </systemColor>
    </resources>
</document>`;

const LIGHT_GROUND = "#f7f7f5";
const IMAGE_NAME = "SplashScreenLogo";

describe("applySplashGround with expo-splash-screen on the bare template", () => {
  // What `expo prebuild` does without a splash image: expo-splash-screen removes the image, then
  // applySplashGround runs on the same parsed storyboard.
  async function prebuild(contents: string): Promise<string> {
    const ib = await loadInterfaceBuilder();
    const xml = ib.removeImageFromSplashScreen(await ib.toObjectAsync(contents), {
      imageName: IMAGE_NAME,
    });
    return ib.toString(applySplashGround(xml, LIGHT_GROUND));
  }

  test("replaces systemBackgroundColor with the SplashScreenBackground colour set", async () => {
    const xml = await prebuild(BARE_TEMPLATE);
    expect(BARE_TEMPLATE).toContain('systemColor="systemBackgroundColor"');
    expect(xml).not.toContain("systemBackgroundColor");
    expect(xml).toContain('<color key="backgroundColor" name="SplashScreenBackground"/>');
    expect(xml).toContain(
      '<color alpha="1.000" blue="0.960784313725490" green="0.968627450980392" red="0.968627450980392" customColorSpace="sRGB" colorSpace="custom"/>',
    );
  });

  test("a second prebuild on its own output gives byte-identical XML", async () => {
    const once = await prebuild(BARE_TEMPLATE);
    expect(await prebuild(once)).toBe(once);
  });

  test("gives the same colour as expo-splash-screen's own path with an image", async () => {
    const ib = await loadInterfaceBuilder();
    const withImage = ib.applyImageToSplashScreenXML(await ib.toObjectAsync(BARE_TEMPLATE), {
      imageName: IMAGE_NAME,
      contentMode: "scaleAspectFit",
      backgroundColor: LIGHT_GROUND,
      enableFullScreenImage: false,
      imageWidth: 100,
    });
    const upstream = structuredClone(withImage);
    const composed = applySplashGround(withImage, LIGHT_GROUND);
    const resources = (storyboard: Storyboard) =>
      (storyboard.document.resources as XmlElement[])[0] as XmlElement;
    // Same view colour and the same named colour, byte for byte.
    expect(rootView(composed).color).toEqual(rootView(upstream).color);
    expect(rootView(upstream).color).toEqual([
      { $: { key: "backgroundColor", name: "SplashScreenBackground" } },
    ]);
    expect(resources(composed).namedColor).toEqual(resources(upstream).namedColor);
    // The only difference: upstream keeps the template's now-unused systemBackgroundColor resource.
    expect(ib.toString(composed)).toBe(
      ib
        .toString(upstream)
        .replace(/\s*<systemColor name="systemBackgroundColor">[\s\S]*?<\/systemColor>/, ""),
    );
  });
});
