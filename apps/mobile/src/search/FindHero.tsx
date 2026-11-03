import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';

/** Futsal court markings from the web SportCourt drawing (120×80 box). */
const COURT =
  'M60 2v76M72 40a12 12 0 1 1-24 0 12 12 0 0 1 24 0M2 22h14a18 18 0 0 1 0 36H2M118 22h-14a18 18 0 0 0 0 36h14';

/** One ball crossing, in ms. */
const RALLY_MS = 2600;
const FADE_MS = 700;

/** The four-square logo mark (web favicon), in ball colour. */
function Mark({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="7 8 18 16" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={7} y={8} width={8} height={7} rx={1.5} fill={color} />
      <Rect x={17} y={8} width={8} height={7} rx={1.5} fill={color} opacity={0.45} />
      <Rect x={7} y={17} width={8} height={7} rx={1.5} fill={color} opacity={0.45} />
      <Rect x={17} y={17} width={8} height={7} rx={1.5} fill={color} />
    </Svg>
  );
}

/**
 * Top of the Find tab: a surround-green court panel with chalk markings, the BookaTurf mark and the headline, and the
 * search box (children) on it. The court fades in and a ball rallies across the top end; reduced motion shows both still.
 */
export function FindHero({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const [width, setWidth] = useState(0);
  const shown = useRef(new Animated.Value(0)).current;
  const rally = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((still) => {
      if (!live) return;
      if (still) {
        shown.setValue(1);
        rally.setValue(1);
        return;
      }
      Animated.timing(shown, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
      const cross = (toValue: number) =>
        Animated.timing(rally, { toValue, duration: RALLY_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
      loop = Animated.loop(Animated.sequence([cross(1), cross(0)]));
      loop.start();
    });
    return () => {
      live = false;
      loop?.stop();
    };
  }, [shown, rally]);

  // The ball crosses the end half of the top row and hops once per crossing.
  const start = width * 0.55;
  const end = Math.max(start, width - t.space4 - t.authBall);
  const hop = t.space3;
  const ballStyle = {
    opacity: shown,
    transform: [
      { translateX: rally.interpolate({ inputRange: [0, 1], outputRange: [start, end] }) },
      { translateY: rally.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -hop, 0], easing: Easing.out(Easing.quad) }) },
    ],
  };

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ backgroundColor: t.surround, borderRadius: t.radiusXl, overflow: 'hidden', padding: t.space4, gap: t.space3 }}
    >
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: shown }}>
        <Svg width="100%" height="100%" viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice">
          <Rect x={2} y={2} width={116} height={76} rx={2} fill="none" stroke={t.onNightLine} strokeWidth={t.courtLine} vectorEffect="non-scaling-stroke" />
          <Path d={COURT} fill="none" stroke={t.onNightLine} strokeWidth={t.courtLine} vectorEffect="non-scaling-stroke" />
        </Svg>
      </Animated.View>
      {width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: t.space4 + hop, left: 0, width: t.authBall, height: t.authBall, borderRadius: t.radiusFull, backgroundColor: t.ball, ...t.shadowBall },
            ballStyle,
          ]}
        />
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
        <Mark size={t.iconLg} color={t.ball} />
        <Text variant="title" weight="bold" style={{ color: t.chalk }} accessibilityRole="header">
          {tr('app.name')}
        </Text>
      </View>
      <Text variant="heading" style={{ color: t.chalk }}>
        {tr('landing.title')}
      </Text>
      {children}
    </View>
  );
}
