import React from "react";
import { Text, Link, Flex } from "figma-kit";

export const Footer: React.FC = () => {
    return (
        <Flex gap="2" justify="between" align="end">
            <Text style={{ color: 'var(--figma-color-text-secondary)' }}>
                This is an open source plugin. <Link target="_blank" href="https://github.com/atropical/icontopia">Contribute ↗</Link>
            </Text>
            <Text style={{ color: 'var(--figma-color-text-secondary)' }}>
                AI vibed + human polished from Norway by <Link target="_blank" href="https://atropical.no?utm_source=figma-plugin">Atropical</Link>.
            </Text>
        </Flex>
    );
};
