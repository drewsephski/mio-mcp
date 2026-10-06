import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";

const dotCount = 8;
const inputRange = Array.from({ length: dotCount + 1 }, (_, index) => index);
const opacities = [0.25, 1, 0.75, 0.55, 0.35, 0.325, 0.3, 0.275];
const scales = [0.65, 1, 0.85, 0.775, 0.7, 0.6875, 0.675, 0.6625];

function stagger(values: number[], index: number) {
  return inputRange.map(step => values[(step - index + dotCount) % dotCount]);
}

export function DotsRing({ size = 24, color = "#2458d3", label = "Loading" }: { size?: number; color?: string; label?: string }) {
  const [progress] = useState(() => new Animated.Value(0));
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReducedMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { alive = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    progress.setValue(0);
    if (reducedMotion) return;
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: dotCount,
      duration: 1000,
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    }));
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);

  const dotSize = size * 0.2;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} style={{ width: size, height: size }}>
      {Array.from({ length: dotCount }, (_, index) => {
        const angle = index / dotCount * Math.PI * 2;
        return <Animated.View key={index} style={{
          position: "absolute",
          left: (size - dotSize) / 2 + Math.sin(angle) * size * 0.34,
          top: (size - dotSize) / 2 - Math.cos(angle) * size * 0.34,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: color,
          opacity: reducedMotion ? 0.75 : progress.interpolate({ inputRange, outputRange: stagger(opacities, index) }),
          transform: [{ scale: reducedMotion ? 1 : progress.interpolate({ inputRange, outputRange: stagger(scales, index) }) }],
        }} />;
      })}
    </View>
  );
}
