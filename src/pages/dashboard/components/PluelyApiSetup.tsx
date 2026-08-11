import { useState, useEffect, useRef } from "react";
import { LogInIcon, LogOutIcon, LoaderIcon, ChevronDown } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "@/contexts";
import { useAuth } from "@/hooks";
import {
  Button,
  Header,
  Switch,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components";

interface Model {
  provider: string;
  name: string;
  id: string;
  model: string;
  description: string;
  modality: string;
  isAvailable: boolean;
}

const SELECTED_PLUELY_MODEL_STORAGE_KEY = "selected_pluely_model";

export const PluelyApiSetup = () => {
  const { pluelyApiEnabled, setPluelyApiEnabled, setSupportsImages } = useApp();
  const {
    signed_in,
    me,
    offline,
    loading: isAuthLoading,
    error: authError,
    signIn,
    signOut,
  } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const fetchInitiated = useRef(false);
  const commandListRef = useRef<HTMLDivElement>(null);

  const entitled = me?.entitled ?? false;

  useEffect(() => {
    loadSelectedModel();
    if (!fetchInitiated.current) {
      fetchInitiated.current = true;
      fetchModels();
    }
  }, []);

  // Signing out mid-session must also stop routing requests to the Pluely API.
  useEffect(() => {
    if (!isAuthLoading && !entitled && pluelyApiEnabled) {
      setPluelyApiEnabled(false);
    }
  }, [entitled, isAuthLoading]);

  // Scroll to top when search value changes
  useEffect(() => {
    if (commandListRef.current) {
      commandListRef.current.scrollTop = 0;
    }
  }, [searchValue]);

  const fetchModels = async () => {
    setIsModelsLoading(true);
    try {
      const fetchedModels = await invoke<Model[]>("fetch_models");
      setModels(fetchedModels);
    } catch (error) {
      console.error("Failed to fetch models:", error);
    } finally {
      setIsModelsLoading(false);
    }
  };

  const loadSelectedModel = async () => {
    try {
      const storage = await invoke<{ selected_pluely_model?: string }>(
        "secure_storage_get"
      );
      if (storage.selected_pluely_model) {
        setSelectedModel(JSON.parse(storage.selected_pluely_model));
      } else {
        setSelectedModel(null);
      }
    } catch (err) {
      console.error("Failed to load model selection:", err);
      setSelectedModel(null);
    }
  };

  const handleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      // Opens the system browser; the pluely:// deep link completes sign-in
      // and useAuth picks it up via the auth-changed event.
      await signIn();
    } catch (err) {
      console.error("Sign-in failed to start:", err);
      setError(typeof err === "string" ? err : "Could not open the browser");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await signOut();
      setPluelyApiEnabled(false);
    } catch (err) {
      console.error("Sign-out failed:", err);
      setError("Failed to sign out");
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelSelect = async (model: Model) => {
    setSelectedModel(model);
    setIsPopoverOpen(false); // Close popover when model is selected
    setSearchValue(""); // Reset search when model is selected

    // Update supportsImages based on the selected model
    if (pluelyApiEnabled) {
      const hasImageSupport = model.modality?.includes("image") ?? false;
      setSupportsImages(hasImageSupport);
    }

    try {
      await invoke("secure_storage_save", {
        items: [
          {
            key: SELECTED_PLUELY_MODEL_STORAGE_KEY,
            value: JSON.stringify(model),
          },
        ],
      });
    } catch (error) {
      console.error("Failed to save model selection:", error);
      setError("Failed to save model selection.");
    }
  };

  const handlePopoverOpenChange = (open: boolean) => {
    setIsPopoverOpen(open);
    if (open) {
      setSearchValue(""); // Reset search when popover opens
    }
  };

  const providers = [...new Set(models.map((model) => model.provider))];
  const capitalizedProviders = providers.map(
    (p) => p.charAt(0).toUpperCase() + p.slice(1)
  );

  let providerList;
  if (capitalizedProviders.length === 0) {
    providerList = null;
  } else if (capitalizedProviders.length === 1) {
    providerList = capitalizedProviders[0];
  } else if (capitalizedProviders.length === 2) {
    providerList = capitalizedProviders.join(" and ");
  } else {
    const lastProvider = capitalizedProviders.pop();
    providerList = `${capitalizedProviders.join(", ")}, and ${lastProvider}`;
  }

  const title = isModelsLoading
    ? "Loading Models..."
    : `Pluely supports ${models?.length} model${
        models?.length !== 1 ? "s" : ""
      }`;

  const description = isModelsLoading
    ? "Fetching the list of supported models..."
    : providerList
    ? `Access top models from providers like ${providerList}. and select smaller models for faster responses.`
    : "Explore all the models Pluely supports.";

  const shownError = error ?? authError;

  return (
    <div id="pluely-api" className="space-y-3 -mt-2">
      <div className="space-y-2 pt-2">
        {/* Error Message */}
        {shownError && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
            <p className="text-sm text-red-700 dark:text-red-400">
              {shownError}
            </p>
          </div>
        )}

        <Header title={title} description={description} />
        <Popover
          modal={true}
          open={isPopoverOpen}
          onOpenChange={handlePopoverOpenChange}
        >
          <PopoverTrigger
            asChild
            disabled={isModelsLoading}
            className="cursor-pointer flex justify-start"
          >
            <Button
              variant="outline"
              className="h-11 text-start shadow-none w-full"
            >
              {selectedModel ? selectedModel.name : "Select pro models"}{" "}
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            className="w-[calc(100vw-20rem)] p-0 rounded-xl overflow-hidden"
          >
            <Command shouldFilter={true}>
              <CommandInput
                placeholder="Select model..."
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList
                ref={commandListRef}
                className="rounded-xl h-full overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-muted [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/30"
              >
                <CommandEmpty>
                  No models found. Please try again later.
                </CommandEmpty>
                <CommandGroup className="h-full rounded-xl">
                  {models.map((model, index) => (
                    <CommandItem
                      disabled={!model?.isAvailable}
                      key={`${model?.id}-${index}`}
                      className="cursor-pointer"
                      onSelect={() => handleModelSelect(model)}
                    >
                      <div className="flex flex-col">
                        <div className="flex flex-row items-center gap-2">
                          <p className="text-sm font-medium">{`${model?.name}`}</p>
                          <div className="text-xs border border-input/50 bg-muted/50 rounded-full px-2">
                            {model?.modality}
                          </div>
                          {model?.isAvailable ? (
                            <div className="text-xs text-orange-600 bg-white rounded-full px-2">
                              {model?.provider}
                            </div>
                          ) : (
                            <div className="text-xs text-red-600 bg-white rounded-full px-2">
                              Not Available
                            </div>
                          )}
                        </div>
                        <p
                          className="text-sm text-muted-foreground line-clamp-2"
                          title={model?.description}
                        >
                          {model?.description}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {/* this model only supports these modalities */}
        {selectedModel && (
          <div className="text-xs text-amber-500 bg-amber-500/10 p-3 rounded-md">
            {selectedModel.modality?.includes("image")
              ? "This model accepts both text and images as input and generates text responses."
              : "⚠️ This model ONLY accepts text input. Do NOT upload images - they will not work with this model. Use a text+image→text model if you need image support."}
          </div>
        )}

        {/* Account */}
        <div className="space-y-2">
          {!signed_in ? (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium">Account</label>
                <p className="text-sm font-medium text-muted-foreground">
                  Sign in from your browser to use Pluely models — no license
                  key, no copy-paste. Your own API keys keep working without an
                  account.
                </p>
              </div>
              <Button
                onClick={handleSignIn}
                disabled={isLoading || isAuthLoading}
                className="h-11"
              >
                {isLoading ? (
                  <LoaderIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <LogInIcon className="h-4 w-4" />
                )}
                Sign in with browser
              </Button>
            </>
          ) : (
            <>
              <label className="text-xs lg:text-sm font-medium">Account</label>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-input/50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{me?.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {entitled ? "Pro" : "Free"} plan
                    {offline ? " · offline (cached)" : ""}
                  </p>
                </div>
                <Button
                  onClick={handleSignOut}
                  disabled={isLoading}
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  title="Sign out"
                >
                  {isLoading ? (
                    <LoaderIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOutIcon className="h-4 w-4" />
                  )}
                  Sign out
                </Button>
              </div>
              {!entitled && (
                <p className="text-sm font-medium text-muted-foreground">
                  Your account has no active subscription — upgrade at
                  pluely.com/pricing to use Pluely models.
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex justify-between items-center">
        <Header
          title={`${pluelyApiEnabled ? "Disable" : "Enable"} Pluely API`}
          description={
            entitled
              ? pluelyApiEnabled
                ? "Using all pluely APIs for audio, and chat."
                : "Using all your own AI Providers for audio, and chat."
              : "A Pro subscription is required to enable Pluely API, or you can use your own AI Providers and STT Providers."
          }
        />
        <Switch
          checked={pluelyApiEnabled}
          onCheckedChange={setPluelyApiEnabled}
          disabled={!entitled} // Pro only; BYO providers need no account
        />
      </div>
    </div>
  );
};
