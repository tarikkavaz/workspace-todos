const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'node_modules', 'monaco-editor', 'min', 'vs');
const targetDir = path.join(__dirname, '..', 'lib', 'monaco-editor', 'min', 'vs');

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach(childItemName => {
            copyRecursiveSync(
                path.join(src, childItemName),
                path.join(dest, childItemName)
            );
        });
    } else {
        // Copy file, but resolve symlinks first
        const resolvedSrc = fs.realpathSync(src);
        fs.copyFileSync(resolvedSrc, dest);
    }
}

console.log('Copying Monaco Editor files...');
console.log(`Source: ${sourceDir}`);
console.log(`Target: ${targetDir}`);

try {
    // Remove target directory if it exists
    if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
    }
    
    // Copy Monaco Editor files
    copyRecursiveSync(sourceDir, targetDir);
    
    console.log('Monaco Editor files copied successfully!');
} catch (error) {
    console.error('Error copying Monaco Editor files:', error);
    process.exit(1);
}
