/**
 * Script validation for execute_script action.
 * Validates scripts before execution to prevent dangerous operations
 * like arbitrary file system access, network calls, and process spawning.
 */

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  blockedPatterns: string[];
}

/** Patterns blocked in Python scripts */
const PYTHON_BLOCKED_PATTERNS: { pattern: RegExp; description: string }[] = [
  // File system destructive operations
  { pattern: /os\.remove\s*\(/i, description: 'os.remove() - file deletion' },
  { pattern: /os\.rmdir\s*\(/i, description: 'os.rmdir() - directory removal' },
  { pattern: /os\.unlink\s*\(/i, description: 'os.unlink() - file unlinking' },
  { pattern: /shutil\.rmtree\s*\(/i, description: 'shutil.rmtree() - recursive directory removal' },
  { pattern: /shutil\.move\s*\(/i, description: 'shutil.move() - file/directory move' },
  { pattern: /pathlib\.Path\s*\(.*\)\.unlink/i, description: 'pathlib unlink - file deletion' },

  // Process spawning
  { pattern: /subprocess\./i, description: 'subprocess module - process spawning' },
  { pattern: /os\.system\s*\(/i, description: 'os.system() - shell command execution' },
  { pattern: /os\.popen\s*\(/i, description: 'os.popen() - pipe to shell command' },
  { pattern: /os\.exec[lvpe]*\s*\(/i, description: 'os.exec*() - process replacement' },
  { pattern: /os\.spawn[lvpe]*\s*\(/i, description: 'os.spawn*() - process spawning' },

  // Dynamic code execution
  { pattern: /(?<!\w)exec\s*\(/i, description: 'exec() - dynamic code execution' },
  { pattern: /(?<!\w)eval\s*\(/i, description: 'eval() - dynamic expression evaluation' },
  { pattern: /__import__\s*\(/i, description: '__import__() - dynamic module import' },
  { pattern: /importlib\./i, description: 'importlib - dynamic module loading' },
  { pattern: /compile\s*\(.*,\s*['"]exec['"]/i, description: 'compile() with exec mode' },

  // Network operations
  { pattern: /(?:urllib|requests|http\.client|socket)\./i, description: 'Network library usage' },
  { pattern: /from\s+(?:urllib|requests|http|socket)\s+import/i, description: 'Network library import' },
  { pattern: /import\s+(?:urllib|requests|http|socket)/i, description: 'Network module import' },

  // Dangerous imports
  { pattern: /import\s+ctypes/i, description: 'ctypes - native memory access' },
  { pattern: /from\s+ctypes\s+import/i, description: 'ctypes import - native memory access' },
  { pattern: /import\s+multiprocessing/i, description: 'multiprocessing - process spawning' },
  { pattern: /import\s+threading/i, description: 'threading - thread creation' },

  // File write operations outside project
  { pattern: /open\s*\([^)]*['"][wax]/i, description: 'open() with write mode' },
  { pattern: /open\s*\([^)]*mode\s*=\s*['"][wax]/i, description: 'open() with write mode parameter' },
];

/** Patterns blocked in C++/console batch scripts */
const CONSOLE_BATCH_BLOCKED_PATTERNS: { pattern: RegExp; description: string }[] = [
  // Engine termination
  { pattern: /(?:^|\s)(?:quit|exit|kill|crash)(?:\s|$)/i, description: 'Engine termination command' },
  { pattern: /(?:^|\s)(?:r\.gpucrash|r\.crash|debug\s+crash|forcecrash|debug\s+break)(?:\s|$)/i, description: 'Crash-inducing command' },

  // Shell injection
  { pattern: /[&|;`]/i, description: 'Shell metacharacter (command chaining/piping)' },

  // Python execution via console
  { pattern: /^(?:py|python)(?:\s|$)/i, description: 'Python execution via console' },

  // Dangerous operations
  { pattern: /(?:^|\s)(?:assert\s+false|check\s*\(\s*false\s*\))(?:\s|$)/i, description: 'Assertion failure command' },
  { pattern: /(?:^|\s)(?:obj\s+garbage|obj\s+list|memreport)(?:\s|$)/i, description: 'Heavy debug command' },
];

/** Patterns that generate warnings but do not block execution */
const PYTHON_WARNING_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /open\s*\(/i, description: 'File open() detected - ensure read-only usage for safety' },
  { pattern: /import\s+os/i, description: 'os module imported - some os operations are restricted' },
  { pattern: /import\s+shutil/i, description: 'shutil module imported - some shutil operations are restricted' },
  { pattern: /import\s+glob/i, description: 'glob module imported - file scanning detected' },
  { pattern: /import\s+json/i, description: 'json module imported - ensure no sensitive data is written' },
];

/**
 * Validates a script for dangerous patterns before execution.
 * @param scriptType - The type of script: "python", "console_batch", or "editor_utility"
 * @param content - The script content to validate
 * @returns ValidationResult with validity status, warnings, errors, and blocked patterns
 */
export function validateScript(scriptType: string, content: string): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    warnings: [],
    errors: [],
    blockedPatterns: [],
  };

  if (!content || typeof content !== 'string') {
    result.valid = false;
    result.errors.push('Script content is empty or not a string');
    return result;
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    result.valid = false;
    result.errors.push('Script content is empty after trimming');
    return result;
  }

  // Maximum script size check (64KB)
  if (content.length > 65536) {
    result.valid = false;
    result.errors.push(`Script content exceeds maximum size (${content.length} bytes > 65536 bytes)`);
    return result;
  }

  switch (scriptType.toLowerCase()) {
    case 'python':
      validatePythonScript(trimmed, result);
      break;

    case 'console_batch':
      validateConsoleBatchScript(trimmed, result);
      break;

    case 'editor_utility':
      validateEditorUtilityScript(trimmed, result);
      break;

    default:
      result.valid = false;
      result.errors.push(`Unknown script type: ${scriptType}. Expected "python", "console_batch", or "editor_utility"`);
  }

  return result;
}

function validatePythonScript(content: string, result: ValidationResult): void {
  // Check each blocked pattern
  for (const { pattern, description } of PYTHON_BLOCKED_PATTERNS) {
    if (pattern.test(content)) {
      result.valid = false;
      result.errors.push(`Blocked pattern detected: ${description}`);
      result.blockedPatterns.push(description);
    }
  }

  // Check warning patterns (don't block, just warn)
  for (const { pattern, description } of PYTHON_WARNING_PATTERNS) {
    if (pattern.test(content)) {
      result.warnings.push(description);
    }
  }
}

function validateConsoleBatchScript(content: string, result: ValidationResult): void {
  // Split by newlines and validate each command
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip comments
    if (line.startsWith('//') || line.startsWith('#')) {
      continue;
    }

    for (const { pattern, description } of CONSOLE_BATCH_BLOCKED_PATTERNS) {
      if (pattern.test(line)) {
        result.valid = false;
        result.errors.push(`Line ${i + 1}: Blocked pattern - ${description}`);
        result.blockedPatterns.push(`Line ${i + 1}: ${description}`);
      }
    }
  }

  if (lines.length > 100) {
    result.warnings.push(`Script contains ${lines.length} commands - execution may take a while`);
  }
}

function validateEditorUtilityScript(content: string, result: ValidationResult): void {
  // For editor utility, the content is an asset path to a Blueprint/Widget
  const trimmed = content.trim();

  // Validate it looks like a valid UE asset path
  if (!trimmed.startsWith('/Game/') && !trimmed.startsWith('/Engine/') && !trimmed.startsWith('/Script/')) {
    result.valid = false;
    result.errors.push(
      'Editor utility path must start with /Game/, /Engine/, or /Script/. ' +
      `Got: "${trimmed.substring(0, 50)}${trimmed.length > 50 ? '...' : ''}"`
    );
  }

  // Check for path traversal
  if (trimmed.includes('..')) {
    result.valid = false;
    result.errors.push('Path traversal (..) is not allowed in editor utility paths');
    result.blockedPatterns.push('Path traversal (..)');
  }

  // Warn if path has unusual characters
  if (/[<>"|?*]/.test(trimmed)) {
    result.warnings.push('Path contains unusual characters that may cause issues');
  }
}
