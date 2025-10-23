use std::process::Command;

fn main() {
    // Tell Cargo to rerun this build script if frontend files change
    println!("cargo:rerun-if-changed=frontend/src");
    println!("cargo:rerun-if-changed=frontend/package.json");
    println!("cargo:rerun-if-changed=frontend/package-lock.json");
    println!("cargo:rerun-if-changed=frontend/index.html");

    let frontend_dir = std::path::Path::new("frontend");
    let node_modules = frontend_dir.join("node_modules");
    let dist_dir = frontend_dir.join("dist");
    let profile = std::env::var("PROFILE").unwrap_or_default();

    // Install dependencies if node_modules doesn't exist
    if !node_modules.exists() {
        println!("cargo:warning=Frontend dependencies not found, running npm install...");
        
        let install_status = Command::new("npm")
            .args(["install"])
            .current_dir(frontend_dir)
            .status();

        match install_status {
            Ok(status) if status.success() => {
                println!("cargo:warning=npm install completed");
            }
            Ok(status) => {
                panic!("npm install failed with status: {}", status);
            }
            Err(e) => {
                panic!("Failed to run npm install: {}", e);
            }
        }
    }

    // Build frontend for release builds or if dist doesn't exist
    let should_build = profile == "release" || !dist_dir.exists();
    
    if should_build {
        println!("cargo:warning=Building frontend assets...");

        let build_status = Command::new("npm")
            .args(["run", "build"])
            .current_dir(frontend_dir)
            .status();

        match build_status {
            Ok(status) if status.success() => {
                println!("cargo:warning=Frontend build completed successfully");
            }
            Ok(status) => {
                panic!("Frontend build failed with status: {}", status);
            }
            Err(e) => {
                panic!("Failed to run npm build: {}", e);
            }
        }
    } else {
        println!("cargo:warning=Frontend dist exists, skipping build (use cargo clean to rebuild)");
    }
}
