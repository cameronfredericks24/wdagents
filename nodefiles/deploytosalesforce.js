const { exec } = require("child_process");
const path = require("path");
const fs = require('fs');

/**
 * Deploys the given path to Salesforce using the new sf CLI.
 * @param {string} pathToDeploy - Path to the metadata file or folder
 * @returns {Promise<string>} - Resolves with stdout, rejects with error
 */
function deployToSalesforce(pathToDeploy) {
    return new Promise((resolve, reject) => {
    const cmd = `sf deploy metadata --source-dir ${pathToDeploy} -o ApprovalOrg`;
    const projectRoot = path.join(__dirname, "..");
    const absPath = path.resolve(projectRoot, pathToDeploy);
    console.log("[DEPLOY DEBUG] Running command:", cmd);
    console.log("[DEPLOY DEBUG] Working directory:", projectRoot);
    console.log("[DEPLOY DEBUG] Path to deploy (as given):", pathToDeploy);
    console.log("[DEPLOY DEBUG] Absolute path to deploy:", absPath);
    // Log file existence
    console.log("[DEPLOY DEBUG] File exists:", fs.existsSync(absPath));
    // Log XML file contents if deploying a file
    if (fs.existsSync(absPath) && fs.lstatSync(absPath).isFile()) {
      try {
        const xmlContent = fs.readFileSync(absPath, 'utf8');
        console.log("[DEPLOY DEBUG] XML file content (first 10 lines):", xmlContent.split('\n').slice(0, 10).join('\n'));
      } catch (e) {
        console.error("[DEPLOY DEBUG] Could not read XML file:", e);
      }
    }
    exec(cmd, { cwd: projectRoot }, (err, stdout, stderr) => {
            if (err) {
        console.error("[DEPLOY ERROR] Command:", cmd);
        console.error("[DEPLOY ERROR] CWD:", projectRoot);
        console.error("[DEPLOY ERROR] STDERR:", stderr);
        console.error("[DEPLOY ERROR] STDOUT:", stdout);
        // Log the first 20 lines of the XML file if deployment fails
        if (fs.existsSync(absPath) && fs.lstatSync(absPath).isFile()) {
          try {
            const failedXml = fs.readFileSync(absPath, 'utf8');
            console.error('[DEPLOY ERROR] Failed XML (first 20 lines):', failedXml.split('\n').slice(0, 20).join('\n'));
          } catch (e) {}
        }
        console.error("[DEPLOY ERROR] Error object:", err);
        reject(stderr + "\n" + stdout);
            } else {
        console.log("[DEPLOY DEBUG] Success STDOUT:", stdout);
                resolve(stdout);
            }
        });
    });
}

module.exports = { deployToSalesforce }; 
